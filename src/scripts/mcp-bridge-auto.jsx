/**
 * After Effects MCP Bridge & AI Layer Copilot (ScriptUI Panel)
 * Features:
 * 1. AI Layer Copilot: Select any layer, enter prompt, auto-capture frame screenshot, let AI modify layer.
 * 2. AI Settings: API key, custom Base URL, auto-fetch models, thinking/reasoning level, multimodal toggles.
 * 3. MCP Server Bridge: Background command queue, auto-run, auto-save, undo, and live logging.
 */

#target aftereffects

(function(thisObj) {
  // --- Embedded JSON for ExtendScript (ECMAScript 3) ---
  var JSON = JSON || {};
  if (typeof JSON.parse !== 'function') {
    JSON.parse = function(str) {
      if (!str) return null;
      return eval('(' + str + ')');
    };
  }
  if (typeof JSON.stringify !== 'function') {
    JSON.stringify = function(o) {
      if (o === null) return "null";
      if (typeof o === "undefined") return "null";
      if (typeof o === "number" || typeof o === "boolean") return String(o);
      if (typeof o === "string") {
        return '"' + o.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + '"';
      }
      if (o instanceof Array) {
        var arr = [];
        for (var i = 0; i < o.length; i++) {
          arr.push(JSON.stringify(o[i]));
        }
        return "[" + arr.join(",") + "]";
      }
      var props = [];
      for (var k in o) {
        if (Object.prototype.hasOwnProperty.call(o, k)) {
          props.push('"' + k + '":' + JSON.stringify(o[k]));
        }
      }
      return "{" + props.join(",") + "}";
    };
  }

  // --- Paths Configuration ---
  var bridgeFolder = new Folder("~/.ae-mcp");
  if (!bridgeFolder.exists) { bridgeFolder.create(); }
  var bridgeDirPath = bridgeFolder.fsName;

  var snapshotsFolder = new Folder(bridgeFolder.fullName + "/snapshots");
  if (!snapshotsFolder.exists) { snapshotsFolder.create(); }

  var cmdFile = new File(bridgeFolder.fullName + "/commands.json");
  var resFile = new File(bridgeFolder.fullName + "/results.json");
  var heartbeatFile = new File(bridgeFolder.fullName + "/heartbeat.json");
  var aiConfigFile = new File(bridgeFolder.fullName + "/ai_config.json");
  var aiReqFile = new File(bridgeFolder.fullName + "/ai_requests.json");
  var aiRespFile = new File(bridgeFolder.fullName + "/ai_responses.json");

  var lastExecutedId = "";
  var scheduledTaskId = 0;
  var isExecuting = false;
  var waitingForAIId = "";

  // --- Helper File IO ---
  function readFile(file) {
    if (!file.exists) return null;
    file.open("r");
    file.encoding = "UTF-8";
    var content = file.read();
    file.close();
    return content;
  }

  function writeFile(file, text) {
    file.open("w");
    file.encoding = "UTF-8";
    file.write(text);
    file.close();
  }

  function appendLog(uiLog, msg) {
    var d = new Date();
    var timeStr = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2) + ":" + ("0" + d.getSeconds()).slice(-2);
    var line = "[" + timeStr + "] " + msg;
    if (uiLog) {
      uiLog.text = line + "\n" + uiLog.text.substring(0, 2000);
    }
  }

  function loadAIConfig() {
    var def = {
      apiKey: "",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      thinkingLevel: "off",
      enableImages: true,
      enableVideos: false,
      autoSaveAfterAI: true,
      availableModels: ["gpt-4o", "gpt-4o-mini", "claude-3-7-sonnet", "deepseek-chat", "deepseek-reasoner"]
    };
    var content = readFile(aiConfigFile);
    if (content) {
      try {
        var parsed = JSON.parse(content);
        for (var k in parsed) { def[k] = parsed[k]; }
      } catch(e){}
    }
    return def;
  }

  function saveAIConfig(cfg) {
    writeFile(aiConfigFile, JSON.stringify(cfg, null, 2));
  }

  var currentAIConfig = loadAIConfig();

  // --- Core Command Execution for MCP ---
  function executePendingCommand(uiElements) {
    if (isExecuting) return;
    if (!cmdFile.exists) return;

    var content = readFile(cmdFile);
    if (!content) return;

    var cmd = null;
    try { cmd = JSON.parse(content); } catch (e) { return; }

    if (!cmd || !cmd.id || cmd.id === lastExecutedId) {
      return;
    }

    isExecuting = true;
    lastExecutedId = cmd.id;

    if (uiElements && uiElements.statusText) {
      uiElements.statusText.text = "MCP Executing: " + cmd.action;
    }
    appendLog(uiElements ? uiElements.logText : null, "MCP Executing: " + cmd.action + " (" + cmd.id + ")");

    var savedPath = null;
    var snapshotFile = null;

    if (cmd.autoSave && app.project) {
      var saveMode = cmd.saveMode || "both";
      if ((saveMode === "snapshot" || saveMode === "both") && cmd.snapshotPath) {
        try {
          var snapFile = new File(cmd.snapshotPath);
          app.project.save(snapFile);
          snapshotFile = snapFile.fsName;
          appendLog(uiElements ? uiElements.logText : null, "Snapshot: " + snapFile.name);
        } catch(se){}
      }
      if ((saveMode === "project" || saveMode === "both") && app.project.file) {
        try {
          app.project.save();
          savedPath = app.project.file.fsName;
        } catch(pe){}
      }
    }

    var resultData = null;
    var errorMsg = null;
    var success = false;

    try {
      if (cmd.undoGroupName) {
        app.beginUndoGroup(cmd.undoGroupName);
      } else {
        app.beginUndoGroup("MCP: " + cmd.action);
      }

      resultData = eval(cmd.script);
      app.endUndoGroup();
      success = true;
    } catch (err) {
      try { app.endUndoGroup(); } catch(e){}
      errorMsg = err.toString();
      success = false;
      appendLog(uiElements ? uiElements.logText : null, "Error: " + errorMsg);
    }

    var resultObj = {
      id: cmd.id,
      timestamp: new Date().getTime(),
      success: success,
      data: resultData,
      error: errorMsg,
      saved: Boolean(savedPath || snapshotFile),
      savedPath: savedPath,
      snapshotPath: snapshotFile
    };

    try { writeFile(resFile, JSON.stringify(resultObj)); } catch(e){}

    if (uiElements && uiElements.statusText) {
      uiElements.statusText.text = success ? "Ready (Last: " + cmd.action + " OK)" : "Error on " + cmd.action;
    }

    isExecuting = false;
  }

  // --- UI Creation: Tabbed Panel ---
  var win = (thisObj instanceof Panel) ? thisObj : new Window("palette", "After Effects 控制台", undefined, { resizeable: true });
  win.orientation = "column";
  win.alignChildren = ["fill", "top"];
  win.spacing = 4;
  win.margins = 6;

  var tabs = win.add("tabbedpanel");
  tabs.alignChildren = ["fill", "top"];

  // ==================== TAB 1: 图层助理 ====================
  var tabAI = tabs.add("tab", undefined, "图层助理");
  tabAI.orientation = "column";
  tabAI.alignChildren = ["fill", "top"];
  tabAI.spacing = 6;

  // Selected layer status row
  var selRow = tabAI.add("group");
  selRow.orientation = "row";
  selRow.alignChildren = ["left", "center"];
  var selLabel = selRow.add("statictext", undefined, "选中图层: ");
  var selNameTxt = selRow.add("statictext", undefined, "未选择图层");
  selNameTxt.characters = 20;
  var refreshSelBtn = selRow.add("button", undefined, "刷新");

  function getSelectedLayer() {
    if (app.project && app.project.activeItem && app.project.activeItem instanceof CompItem) {
      var comp = app.project.activeItem;
      if (comp.selectedLayers.length > 0) {
        return { comp: comp, layer: comp.selectedLayers[0] };
      }
    }
    return null;
  }

  function updateSelectedLayerDisplay() {
    var sel = getSelectedLayer();
    if (sel) {
      selNameTxt.text = sel.layer.name + " (#" + sel.layer.index + ")";
    } else {
      selNameTxt.text = "未选中图层 (请在时间线选中)";
    }
  }

  refreshSelBtn.onClick = updateSelectedLayerDisplay;

  // Prompt input
  var promptGroup = tabAI.add("group");
  promptGroup.orientation = "column";
  promptGroup.alignChildren = ["fill", "top"];
  promptGroup.spacing = 2;
  promptGroup.add("statictext", undefined, "修改要求 (Prompt):");
  var promptEdit = promptGroup.add("edittext", undefined, "给这个图层做一个平滑的淡入，然后带轻微弹跳的下落动画", { multiline: true });
  promptEdit.preferredSize = [-1, 60];

  // Preset prompts row
  var presetRow = tabAI.add("group");
  presetRow.orientation = "row";
  presetRow.alignChildren = ["left", "center"];
  presetRow.add("statictext", undefined, "常用预设:");
  var presetList = ["选择预设...", "弹性入场动画", "发光呼吸闪烁", "霓虹风格调整", "三维立体翻转", "高斯模糊淡出", "动感冲击缩放"];
  var presetDrop = presetRow.add("dropdownlist", undefined, presetList);
  presetDrop.selection = 0;
  presetDrop.onChange = function() {
    if (presetDrop.selection && presetDrop.selection.index > 0) {
      var prompts = [
        "",
        "给图层 Position 属性打关键帧：从上方快速落入并带有 75% 速度曲线弹跳，同时 Opacity 从 0 淡入到 100",
        "添加 Glow 发光特效，对 Glow Radius 打关键帧实现随时间缓慢呼吸脉动的闪烁效果",
        "将图层调整为霓虹发光风格：添加 Glow 特效，颜色调整为青紫色，并添加细微位置抖动表达式",
        "开启 3D 图层开关，Y 轴旋转从 -90 度快速翻转到 0 度，速度曲线设为 dynamicSnap 强缓动",
        "添加 Fast Box Blur 特效，模糊度从 50 关键帧淡出到 0，同时不透明度从 0 渐变到 100",
        "Scale 缩放从 30% 迅速冲击到 110% 再回弹至 100%，给关键帧设置 80% 高影响度速度曲线"
      ];
      promptEdit.text = prompts[presetDrop.selection.index];
    }
  };

  // Multimodal options row
  var aiOptRow = tabAI.add("group");
  aiOptRow.orientation = "row";
  var chkAttachImage = aiOptRow.add("checkbox", undefined, "附带当前帧截图（视觉上下文）");
  chkAttachImage.value = currentAIConfig.enableImages;
  var chkAutoSaveAI = aiOptRow.add("checkbox", undefined, "修改后自动保存与快照");
  chkAutoSaveAI.value = currentAIConfig.autoSaveAfterAI;

  // Action Buttons
  var aiBtnRow = tabAI.add("group");
  aiBtnRow.orientation = "row";
  var runAIBtn = aiBtnRow.add("button", undefined, "应用修改");
  var undoAIBtn = aiBtnRow.add("button", undefined, "撤销修改");

  // Output Status Box
  tabAI.add("statictext", undefined, "执行状态与说明:");
  var aiStatusBox = tabAI.add("edittext", undefined, "准备就绪。在时间线中选中图层，输入修改要求后点击[应用修改]。", { multiline: true, readonly: true });
  aiStatusBox.preferredSize = [-1, 90];

  undoAIBtn.onClick = function() {
    try {
      var undoCmd = app.findMenuCommandId("Undo");
      if (undoCmd && undoCmd !== 0) app.executeCommand(undoCmd);
      else app.executeCommand(16);
      aiStatusBox.text = "已撤销上一步操作。";
    } catch(e) {
      aiStatusBox.text = "撤销失败: " + e.toString();
    }
  };

  runAIBtn.onClick = function() {
    var sel = getSelectedLayer();
    if (!sel) {
      alert("请先在时间线中选中一个图层。");
      return;
    }

    var promptStr = promptEdit.text;
    if (!promptStr || promptStr.replace(/\s+/g, "") === "") {
      alert("请输入修改要求。");
      return;
    }

    aiStatusBox.text = "正在准备图层数据并请求模型处理，请稍候...";
    var reqId = "ai-req-" + new Date().getTime();
    waitingForAIId = reqId;

    var imagePath = null;
    if (chkAttachImage.value && sel.comp.saveFrameToPng) {
      try {
        var screenFile = new File(bridgeDirPath + "/snapshots/ai_frame_" + new Date().getTime() + ".png");
        sel.comp.saveFrameToPng(sel.comp.time, screenFile);
        imagePath = screenFile.fsName;
      } catch(e){}
    }

    var layerInfo = {
      name: sel.layer.name,
      index: sel.layer.index,
      threeDLayer: Boolean(sel.layer.threeDLayer),
      inPoint: sel.layer.inPoint,
      outPoint: sel.layer.outPoint,
      compWidth: sel.comp.width,
      compHeight: sel.comp.height,
      compFrameRate: sel.comp.frameRate
    };

    var aiReq = {
      id: reqId,
      type: "modify_layer",
      timestamp: new Date().getTime(),
      prompt: promptStr,
      layerInfo: layerInfo,
      imagePath: imagePath,
      configOverride: {
        enableImages: chkAttachImage.value,
        autoSaveAfterAI: chkAutoSaveAI.value
      }
    };

    writeFile(aiReqFile, JSON.stringify(aiReq, null, 2));
    aiStatusBox.text = "已发送请求到模型 (" + currentAIConfig.model + ")，正在生成脚本...";
  };

  // ==================== TAB 2: 模型与接口设置 ====================
  var tabSettings = tabs.add("tab", undefined, "模型与接口设置");
  tabSettings.orientation = "column";
  tabSettings.alignChildren = ["fill", "top"];
  tabSettings.spacing = 6;

  // Provider row
  var provRow = tabSettings.add("group");
  provRow.orientation = "row";
  provRow.add("statictext", undefined, "服务商 (Provider):");
  var providers = ["OpenAI", "DeepSeek", "Anthropic Claude", "Google Gemini", "Ollama (本地)", "自定义 (Custom / OneAPI)"];
  var provKeys = ["openai", "deepseek", "anthropic", "gemini", "ollama", "custom"];
  var provDrop = provRow.add("dropdownlist", undefined, providers);

  // Match current provider
  for (var pi = 0; pi < provKeys.length; pi++) {
    if (provKeys[pi] === currentAIConfig.provider) {
      provDrop.selection = pi;
      break;
    }
  }
  if (!provDrop.selection) provDrop.selection = 0;

  // Base URL row
  var urlRow = tabSettings.add("group");
  urlRow.orientation = "row";
  urlRow.add("statictext", undefined, "Base URL:");
  var urlEdit = urlRow.add("edittext", undefined, currentAIConfig.baseUrl);
  urlEdit.preferredSize = [240, -1];

  provDrop.onChange = function() {
    var pKey = provKeys[provDrop.selection.index];
    if (pKey === "openai") urlEdit.text = "https://api.openai.com/v1";
    else if (pKey === "deepseek") urlEdit.text = "https://api.deepseek.com";
    else if (pKey === "anthropic") urlEdit.text = "https://api.anthropic.com/v1";
    else if (pKey === "gemini") urlEdit.text = "https://generativelanguage.googleapis.com/v1beta/openai";
    else if (pKey === "ollama") urlEdit.text = "http://localhost:11434/v1";
  };

  // API Key row
  var keyRow = tabSettings.add("group");
  keyRow.orientation = "row";
  keyRow.add("statictext", undefined, "API Key:");
  var keyEdit = keyRow.add("edittext", undefined, currentAIConfig.apiKey);
  keyEdit.preferredSize = [240, -1];

  // Model selection row
  var modelRow = tabSettings.add("group");
  modelRow.orientation = "row";
  modelRow.add("statictext", undefined, "模型名称:");
  var modelEdit = modelRow.add("edittext", undefined, currentAIConfig.model);
  modelEdit.preferredSize = [150, -1];
  var fetchModelsBtn = modelRow.add("button", undefined, "获取模型列表");

  // Model dropdown row
  var modelDropRow = tabSettings.add("group");
  modelDropRow.orientation = "row";
  modelDropRow.add("statictext", undefined, "可用模型列表:");
  var modelDrop = modelDropRow.add("dropdownlist", undefined, currentAIConfig.availableModels || []);
  modelDrop.preferredSize = [240, -1];
  for (var mi = 0; mi < (currentAIConfig.availableModels || []).length; mi++) {
    if (currentAIConfig.availableModels[mi] === currentAIConfig.model) {
      modelDrop.selection = mi;
      break;
    }
  }
  modelDrop.onChange = function() {
    if (modelDrop.selection) {
      modelEdit.text = modelDrop.selection.text;
    }
  };

  // Thinking / Reasoning Level row
  var thinkRow = tabSettings.add("group");
  thinkRow.orientation = "row";
  thinkRow.add("statictext", undefined, "思考等级 (Reasoning Effort):");
  var thinkLevels = ["关闭 (off)", "低 (low)", "中 (medium)", "高 (high)"];
  var thinkKeys = ["off", "low", "medium", "high"];
  var thinkDrop = thinkRow.add("dropdownlist", undefined, thinkLevels);
  for (var ti = 0; ti < thinkKeys.length; ti++) {
    if (thinkKeys[ti] === currentAIConfig.thinkingLevel) {
      thinkDrop.selection = ti;
      break;
    }
  }
  if (!thinkDrop.selection) thinkDrop.selection = 0;

  // Multimodal toggles in settings
  var capGroup = tabSettings.add("group");
  capGroup.orientation = "column";
  capGroup.alignChildren = ["left", "top"];
  var chkImages = capGroup.add("checkbox", undefined, "支持图片多模态（发送合成截图给模型）");
  chkImages.value = currentAIConfig.enableImages;
  var chkVideos = capGroup.add("checkbox", undefined, "支持视频多模态（允许发送预览片段）");
  chkVideos.value = currentAIConfig.enableVideos;
  var chkSaveAI = capGroup.add("checkbox", undefined, "执行后自动保存与记录快照");
  chkSaveAI.value = currentAIConfig.autoSaveAfterAI;

  var saveCfgBtn = tabSettings.add("button", undefined, "保存配置");
  var cfgStatusTxt = tabSettings.add("statictext", undefined, "配置将自动同步并保存在 ~/.ae-mcp/ai_config.json");

  saveCfgBtn.onClick = function() {
    currentAIConfig.provider = provKeys[provDrop.selection.index];
    currentAIConfig.baseUrl = urlEdit.text;
    currentAIConfig.apiKey = keyEdit.text;
    currentAIConfig.model = modelEdit.text;
    currentAIConfig.thinkingLevel = thinkKeys[thinkDrop.selection.index];
    currentAIConfig.enableImages = chkImages.value;
    currentAIConfig.enableVideos = chkVideos.value;
    currentAIConfig.autoSaveAfterAI = chkSaveAI.value;
    saveAIConfig(currentAIConfig);
    chkAttachImage.value = chkImages.value;
    chkAutoSaveAI.value = chkSaveAI.value;
    cfgStatusTxt.text = "设置已保存。模型: " + currentAIConfig.model + "，思考等级: " + currentAIConfig.thinkingLevel;
  };

  fetchModelsBtn.onClick = function() {
    cfgStatusTxt.text = "正在请求 " + urlEdit.text + "/models 获取模型列表...";
    var fetchReq = {
      id: "fetch-models-" + new Date().getTime(),
      type: "fetch_models",
      timestamp: new Date().getTime(),
      configOverride: {
        provider: provKeys[provDrop.selection.index],
        baseUrl: urlEdit.text,
        apiKey: keyEdit.text
      }
    };
    waitingForAIId = fetchReq.id;
    writeFile(aiReqFile, JSON.stringify(fetchReq, null, 2));
  };

  // ==================== TAB 3: 桥接与系统日志 ====================
  var tabBridge = tabs.add("tab", undefined, "桥接与系统日志");
  tabBridge.orientation = "column";
  tabBridge.alignChildren = ["fill", "top"];
  tabBridge.spacing = 6;

  var statusText = tabBridge.add("statictext", undefined, "状态: 正在监听指令...");
  statusText.characters = 40;

  var chkGroup = tabBridge.add("group");
  chkGroup.orientation = "row";
  var autoRunChk = chkGroup.add("checkbox", undefined, "自动执行指令 (Auto-run)");
  autoRunChk.value = true;
  var autoSaveChk = chkGroup.add("checkbox", undefined, "自动保存工程与快照");
  autoSaveChk.value = true;

  var btnGroup = tabBridge.add("group");
  btnGroup.orientation = "row";
  var undoBtn = btnGroup.add("button", undefined, "撤销上一步");

  var logText = tabBridge.add("edittext", undefined, "桥接初始化完成。等待指令...\n工作目录: " + bridgeDirPath, { multiline: true, readonly: true });
  logText.preferredSize = [-1, 140];

  var uiRefs = {
    statusText: statusText,
    autoRunChk: autoRunChk,
    autoSaveChk: autoSaveChk,
    logText: logText
  };

  undoBtn.onClick = function() {
    try {
      var undoCmd = app.findMenuCommandId("Undo");
      if (undoCmd && undoCmd !== 0) app.executeCommand(undoCmd);
      else app.executeCommand(16);
      appendLog(logText, "执行了撤销指令");
    } catch(e){
      appendLog(logText, "撤销失败: " + e.toString());
    }
  };

  // --- Periodic Checker for Responses & Heartbeat ---
  function checkAIResponse() {
    if (!waitingForAIId || !aiRespFile.exists) return;
    var content = readFile(aiRespFile);
    if (!content) return;

    var resp = null;
    try { resp = JSON.parse(content); } catch(e){ return; }

    if (resp && resp.id === waitingForAIId) {
      waitingForAIId = "";
      if (resp.type === "fetch_models") {
        if (resp.success && resp.models && resp.models.length > 0) {
          modelDrop.removeAll();
          for (var i = 0; i < resp.models.length; i++) {
            modelDrop.add("item", resp.models[i]);
          }
          modelDrop.selection = 0;
          modelEdit.text = resp.models[0];
          cfgStatusTxt.text = "成功获取到 " + resp.models.length + " 个可用模型。";
        } else {
          cfgStatusTxt.text = "获取模型失败: " + (resp.error || "未知错误");
        }
      } else if (resp.type === "modify_layer") {
        if (resp.success && resp.script) {
          aiStatusBox.text = "响应成功，正在应用修改...\n\n说明: " + (resp.explanation || "") + "\n\n代码:\n" + resp.script;
          try {
            var sel = getSelectedLayer();
            if (sel) {
              app.beginUndoGroup("Modify Layer: " + sel.layer.name);
              var layer = sel.layer;
              var comp = sel.comp;
              eval(resp.script);
              app.endUndoGroup();

              if (chkAutoSaveAI.value && app.project.file) {
                app.project.save();
              }
              aiStatusBox.text = "修改已成功应用。\n\n" + (resp.explanation || "");
              appendLog(logText, "已修改图层: " + sel.layer.name);
            } else {
              aiStatusBox.text = "错误: 当前未选中图层，无法应用修改。";
            }
          } catch(execErr) {
            try { app.endUndoGroup(); } catch(ue){}
            aiStatusBox.text = "执行脚本时出错:\n" + execErr.toString();
          }
        } else {
          aiStatusBox.text = "处理失败: " + (resp.error || "未知错误");
        }
      }
    }
  }

  function updateHeartbeat() {
    try {
      var info = {
        timestamp: new Date().getTime(),
        aeVersion: app.version,
        activeProject: (app.project && app.project.file) ? app.project.file.name : "Unsaved Project",
        status: "connected"
      };
      writeFile(heartbeatFile, JSON.stringify(info));
    } catch(e) {}
  }

  // Polling loop
  __aeMcpPoll = function() {
    try {
      if (autoRunChk && autoRunChk.value) {
        executePendingCommand(uiRefs);
      }
      checkAIResponse();
      updateHeartbeat();
    } catch(err) {
      appendLog(logText, "轮询异常: " + err.toString());
    } finally {
      scheduledTaskId = app.scheduleTask("__aeMcpPoll()", 400, false);
    }
  };

  win.onClose = function() {
    if (scheduledTaskId) {
      try { app.cancelTask(scheduledTaskId); } catch(e){}
    }
  };

  if (win instanceof Window) {
    win.center();
    win.show();
  } else {
    win.layout.layout(true);
  }

  // Init display
  updateSelectedLayerDisplay();
  __aeMcpPoll();

})(this);
