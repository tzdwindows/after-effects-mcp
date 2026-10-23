import zipfile
import pickle
import math
import numpy as np
import onnx
from onnx import helper, TensorProto, numpy_helper

class TorchZipLoader(pickle.Unpickler):
    def __init__(self, file, zip_file, prefix='DOVER-Lite/data/'):
        super().__init__(file)
        self.zip_file = zip_file
        self.prefix = prefix
    def persistent_load(self, pid):
        _, storage_type, key, _, size = pid
        raw = self.zip_file.read(self.prefix + str(key))
        return np.frombuffer(raw, dtype=np.float32).copy()
    def find_class(self, module, name):
        if module == 'torch._utils' and name == '_rebuild_tensor_v2':
            def _rebuild(storage, storage_offset, size, stride, requires_grad, backward_hooks):
                arr = storage[storage_offset : storage_offset + int(np.prod(size))]
                return arr.reshape(size)
            return _rebuild
        if module == 'collections' and name == 'OrderedDict':
            from collections import OrderedDict
            return OrderedDict
        if module == 'torch':
            return str
        return super().find_class(module, name)

def load_dover_mobile_weights(pth_path):
    with zipfile.ZipFile(pth_path, 'r') as z:
        with z.open('DOVER-Lite/data.pkl') as f:
            ckpt = TorchZipLoader(f, z).load()
    return ckpt.get('state_dict', ckpt)

def build_dover_mobile_onnx(pth_path, onnx_out_path):
    sd = load_dover_mobile_weights(pth_path)
    nodes = []
    initializers = []

    def add_const(name, arr):
        arr = np.asarray(arr, dtype=np.float32)
        initializers.append(numpy_helper.from_array(arr, name=name))
        return name

    def add_int_const(name, arr):
        arr = np.asarray(arr, dtype=np.int64)
        initializers.append(numpy_helper.from_array(arr, name=name))
        return name

    eps_const = add_const("const_eps_1e6", [1e-6])
    eps_grn = add_const("const_eps_1e12", [1e-12])
    half_const = add_const("const_half", [0.5])
    one_const = add_const("const_one", [1.0])
    sqrt2_const = add_const("const_sqrt2", [math.sqrt(2.0)])

    def add_layernorm_channels_first(x_in, w_name, b_name, prefix):
        # x_in is (N, C, T, H, W)
        w = sd[w_name].reshape(1, -1, 1, 1, 1)
        b = sd[b_name].reshape(1, -1, 1, 1, 1)
        w_init = add_const(prefix + "_ln_w", w)
        b_init = add_const(prefix + "_ln_b", b)

        u = prefix + "_ln_u"
        diff = prefix + "_ln_diff"
        sq = prefix + "_ln_sq"
        var = prefix + "_ln_var"
        var_eps = prefix + "_ln_vareps"
        std = prefix + "_ln_std"
        normed = prefix + "_ln_normed"
        scaled = prefix + "_ln_scaled"
        out = prefix + "_ln_out"

        nodes.append(helper.make_node("ReduceMean", [x_in], [u], axes=[1], keepdims=1))
        nodes.append(helper.make_node("Sub", [x_in, u], [diff]))
        nodes.append(helper.make_node("Mul", [diff, diff], [sq]))
        nodes.append(helper.make_node("ReduceMean", [sq], [var], axes=[1], keepdims=1))
        nodes.append(helper.make_node("Add", [var, eps_const], [var_eps]))
        nodes.append(helper.make_node("Sqrt", [var_eps], [std]))
        nodes.append(helper.make_node("Div", [diff, std], [normed]))
        nodes.append(helper.make_node("Mul", [normed, w_init], [scaled]))
        nodes.append(helper.make_node("Add", [scaled, b_init], [out]))
        return out

    def add_layernorm_channels_last(x_in, w_name, b_name, prefix):
        # x_in is (N, T, H, W, C)
        w_init = add_const(prefix + "_ln_w", sd[w_name])
        b_init = add_const(prefix + "_ln_b", sd[b_name])

        u = prefix + "_ln_u"
        diff = prefix + "_ln_diff"
        sq = prefix + "_ln_sq"
        var = prefix + "_ln_var"
        var_eps = prefix + "_ln_vareps"
        std = prefix + "_ln_std"
        normed = prefix + "_ln_normed"
        scaled = prefix + "_ln_scaled"
        out = prefix + "_ln_out"

        nodes.append(helper.make_node("ReduceMean", [x_in], [u], axes=[-1], keepdims=1))
        nodes.append(helper.make_node("Sub", [x_in, u], [diff]))
        nodes.append(helper.make_node("Mul", [diff, diff], [sq]))
        nodes.append(helper.make_node("ReduceMean", [sq], [var], axes=[-1], keepdims=1))
        nodes.append(helper.make_node("Add", [var, eps_const], [var_eps]))
        nodes.append(helper.make_node("Sqrt", [var_eps], [std]))
        nodes.append(helper.make_node("Div", [diff, std], [normed]))
        nodes.append(helper.make_node("Mul", [normed, w_init], [scaled]))
        nodes.append(helper.make_node("Add", [scaled, b_init], [out]))
        return out

    def add_gelu(x_in, prefix):
        div_out = prefix + "_gelu_div"
        erf_out = prefix + "_gelu_erf"
        add_out = prefix + "_gelu_add"
        mul1_out = prefix + "_gelu_mul1"
        out = prefix + "_gelu_out"
        nodes.append(helper.make_node("Div", [x_in, sqrt2_const], [div_out]))
        nodes.append(helper.make_node("Erf", [div_out], [erf_out]))
        nodes.append(helper.make_node("Add", [erf_out, one_const], [add_out]))
        nodes.append(helper.make_node("Mul", [x_in, add_out], [mul1_out]))
        nodes.append(helper.make_node("Mul", [mul1_out, half_const], [out]))
        return out

    def build_branch(branch_name, input_tensor_name):
        x = input_tensor_name
        depths = [2, 2, 6, 2]
        dims = [48, 96, 192, 384]

        for i in range(4):
            ds_prefix = f"{branch_name}_backbone.downsample_layers.{i}"
            if i == 0:
                w = add_const(ds_prefix + ".0.w", sd[f"{ds_prefix}.0.weight"])
                b = add_const(ds_prefix + ".0.b", sd[f"{ds_prefix}.0.bias"])
                conv_out = f"{ds_prefix}_conv_out"
                nodes.append(helper.make_node(
                    "Conv", [x, w, b], [conv_out],
                    kernel_shape=[2, 4, 4], strides=[2, 4, 4], pads=[0, 0, 0, 0, 0, 0]
                ))
                x = add_layernorm_channels_first(conv_out, f"{ds_prefix}.1.weight", f"{ds_prefix}.1.bias", f"{ds_prefix}_ln")
            else:
                ln_out = add_layernorm_channels_first(x, f"{ds_prefix}.0.weight", f"{ds_prefix}.0.bias", f"{ds_prefix}_ln")
                w = add_const(ds_prefix + ".1.w", sd[f"{ds_prefix}.1.weight"])
                b = add_const(ds_prefix + ".1.b", sd[f"{ds_prefix}.1.bias"])
                conv_out = f"{ds_prefix}_conv_out"
                nodes.append(helper.make_node(
                    "Conv", [ln_out, w, b], [conv_out],
                    kernel_shape=[1, 2, 2], strides=[1, 2, 2], pads=[0, 0, 0, 0, 0, 0]
                ))
                x = conv_out

            for j in range(depths[i]):
                blk_prefix = f"{branch_name}_backbone.stages.{i}.{j}"
                residual = x
                dw_w_arr = sd[f"{blk_prefix}.dwconv.weight"]
                kt = dw_w_arr.shape[2]
                dw_w = add_const(blk_prefix + "_dw_w", dw_w_arr)
                dw_b = add_const(blk_prefix + "_dw_b", sd[f"{blk_prefix}.dwconv.bias"])
                dw_out = f"{blk_prefix}_dw_out"
                nodes.append(helper.make_node(
                    "Conv", [x, dw_w, dw_b], [dw_out],
                    kernel_shape=[kt, 7, 7],
                    strides=[1, 1, 1],
                    pads=[kt // 2, 3, 3, kt // 2, 3, 3],
                    group=dims[i]
                ))

                perm1 = f"{blk_prefix}_perm1"
                nodes.append(helper.make_node("Transpose", [dw_out], [perm1], perm=[0, 2, 3, 4, 1]))

                ln_out = add_layernorm_channels_last(perm1, f"{blk_prefix}.norm.weight", f"{blk_prefix}.norm.bias", blk_prefix)

                pw1_w = add_const(blk_prefix + "_pw1_w", sd[f"{blk_prefix}.pwconv1.weight"].T)
                pw1_b = add_const(blk_prefix + "_pw1_b", sd[f"{blk_prefix}.pwconv1.bias"])
                pw1_mm = f"{blk_prefix}_pw1_mm"
                pw1_out = f"{blk_prefix}_pw1_out"
                nodes.append(helper.make_node("MatMul", [ln_out, pw1_w], [pw1_mm]))
                nodes.append(helper.make_node("Add", [pw1_mm, pw1_b], [pw1_out]))

                act_out = add_gelu(pw1_out, blk_prefix)

                # GRN: Gx = norm(x, p=2, dim=(1,2), keepdim=True)
                grn_sq = f"{blk_prefix}_grn_sq"
                grn_sum = f"{blk_prefix}_grn_sum"
                grn_sum_eps = f"{blk_prefix}_grn_sum_eps"
                grn_gx = f"{blk_prefix}_grn_gx"
                grn_gx_mean = f"{blk_prefix}_grn_gx_mean"
                grn_denom = f"{blk_prefix}_grn_denom"
                grn_nx = f"{blk_prefix}_grn_nx"
                grn_xnx = f"{blk_prefix}_grn_xnx"
                grn_scaled = f"{blk_prefix}_grn_scaled"
                grn_shifted = f"{blk_prefix}_grn_shifted"
                grn_out = f"{blk_prefix}_grn_out"

                gamma_w = add_const(blk_prefix + "_grn_gamma", sd[f"{blk_prefix}.grn.gamma"].reshape(1, 1, 1, 1, -1))
                beta_w = add_const(blk_prefix + "_grn_beta", sd[f"{blk_prefix}.grn.beta"].reshape(1, 1, 1, 1, -1))

                nodes.append(helper.make_node("Mul", [act_out, act_out], [grn_sq]))
                nodes.append(helper.make_node("ReduceSum", [grn_sq], [grn_sum], axes=[1, 2], keepdims=1))
                nodes.append(helper.make_node("Add", [grn_sum, eps_grn], [grn_sum_eps]))
                nodes.append(helper.make_node("Sqrt", [grn_sum_eps], [grn_gx]))
                nodes.append(helper.make_node("ReduceMean", [grn_gx], [grn_gx_mean], axes=[-1], keepdims=1))
                nodes.append(helper.make_node("Add", [grn_gx_mean, eps_const], [grn_denom]))
                nodes.append(helper.make_node("Div", [grn_gx, grn_denom], [grn_nx]))
                nodes.append(helper.make_node("Mul", [act_out, grn_nx], [grn_xnx]))
                nodes.append(helper.make_node("Mul", [grn_xnx, gamma_w], [grn_scaled]))
                nodes.append(helper.make_node("Add", [grn_scaled, beta_w], [grn_shifted]))
                nodes.append(helper.make_node("Add", [grn_shifted, act_out], [grn_out]))

                pw2_w = add_const(blk_prefix + "_pw2_w", sd[f"{blk_prefix}.pwconv2.weight"].T)
                pw2_b = add_const(blk_prefix + "_pw2_b", sd[f"{blk_prefix}.pwconv2.bias"])
                pw2_mm = f"{blk_prefix}_pw2_mm"
                pw2_out = f"{blk_prefix}_pw2_out"
                nodes.append(helper.make_node("MatMul", [grn_out, pw2_w], [pw2_mm]))
                nodes.append(helper.make_node("Add", [pw2_mm, pw2_b], [pw2_out]))

                perm2 = f"{blk_prefix}_perm2"
                nodes.append(helper.make_node("Transpose", [pw2_out], [perm2], perm=[0, 4, 1, 2, 3]))

                blk_out = f"{blk_prefix}_out"
                nodes.append(helper.make_node("Add", [residual, perm2], [blk_out]))
                x = blk_out

        # Final backbone norm
        final_perm1 = f"{branch_name}_final_perm1"
        nodes.append(helper.make_node("Transpose", [x], [final_perm1], perm=[0, 2, 3, 4, 1]))
        final_ln = add_layernorm_channels_last(final_perm1, f"{branch_name}_backbone.norm.weight", f"{branch_name}_backbone.norm.bias", f"{branch_name}_final_norm")
        final_perm2 = f"{branch_name}_final_perm2"
        nodes.append(helper.make_node("Transpose", [final_ln], [final_perm2], perm=[0, 4, 1, 2, 3]))

        # VQAHead
        fc_hid_w = add_const(f"{branch_name}_fc_hid_w", sd[f"{branch_name}_head.fc_hid.weight"])
        fc_hid_b = add_const(f"{branch_name}_fc_hid_b", sd[f"{branch_name}_head.fc_hid.bias"])
        fc_hid_out = f"{branch_name}_fc_hid_out"
        nodes.append(helper.make_node(
            "Conv", [final_perm2, fc_hid_w, fc_hid_b], [fc_hid_out],
            kernel_shape=[1, 1, 1], strides=[1, 1, 1], pads=[0, 0, 0, 0, 0, 0]
        ))
        head_act = add_gelu(fc_hid_out, f"{branch_name}_head")

        fc_last_w = add_const(f"{branch_name}_fc_last_w", sd[f"{branch_name}_head.fc_last.weight"])
        fc_last_b = add_const(f"{branch_name}_fc_last_b", sd[f"{branch_name}_head.fc_last.bias"])
        fc_last_out = f"{branch_name}_fc_last_out"
        nodes.append(helper.make_node(
            "Conv", [head_act, fc_last_w, fc_last_b], [fc_last_out],
            kernel_shape=[1, 1, 1], strides=[1, 1, 1], pads=[0, 0, 0, 0, 0, 0]
        ))

        score_out = f"{branch_name}_score"
        nodes.append(helper.make_node("ReduceMean", [fc_last_out], [score_out], axes=[1, 2, 3, 4], keepdims=0))
        return score_out

    aes_score = build_branch("aesthetic", "aes_view")
    tech_score = build_branch("technical", "tech_view")

    inputs = [
        helper.make_tensor_value_info("aes_view", TensorProto.FLOAT, [None, 3, 32, 224, 224]),
        helper.make_tensor_value_info("tech_view", TensorProto.FLOAT, [None, 3, 32, 224, 224]),
    ]
    outputs = [
        helper.make_tensor_value_info(aes_score, TensorProto.FLOAT, [None]),
        helper.make_tensor_value_info(tech_score, TensorProto.FLOAT, [None]),
    ]

    graph = helper.make_graph(nodes, "DOVER_Mobile_Graph", inputs, outputs, initializer=initializers)
    model = helper.make_model(graph, producer_name="after-effects-mcp", opset_imports=[helper.make_opsetid("", 11)])
    model.ir_version = 7
    onnx.save(model, onnx_out_path)
    print(f"Saved ONNX model to {onnx_out_path}")

if __name__ == "__main__":
    import os
    base_dir = os.path.dirname(os.path.abspath(__file__))
    pth_path = os.path.join(base_dir, "DOVER-Mobile.pth")
    onnx_path = os.path.join(base_dir, "dover_mobile.onnx")
    build_dover_mobile_onnx(pth_path, onnx_path)
