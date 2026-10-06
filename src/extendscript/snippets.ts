/**
 * ExtendScript helper generators for After Effects MCP
 */

export const ExtendScriptHelpers = `
function __findComp(compName) {
  if (compName) {
    for (var i = 1; i <= app.project.numItems; i++) {
      var item = app.project.item(i);
      if (item instanceof CompItem && item.name === compName) {
        return item;
      }
    }
    throw new Error("Composition '" + compName + "' not found.");
  }
  if (app.project.activeItem && app.project.activeItem instanceof CompItem) {
    return app.project.activeItem;
  }
  for (var j = 1; j <= app.project.numItems; j++) {
    if (app.project.item(j) instanceof CompItem) {
      return app.project.item(j);
    }
  }
  throw new Error("No composition found in project.");
}

function __findLayer(comp, layerRef) {
  if (typeof layerRef === "number") {
    if (layerRef >= 1 && layerRef <= comp.numLayers) {
      return comp.layer(layerRef);
    }
    throw new Error("Layer index " + layerRef + " out of range (1-" + comp.numLayers + ").");
  }
  if (typeof layerRef === "string") {
    for (var i = 1; i <= comp.numLayers; i++) {
      if (comp.layer(i).name === layerRef) {
        return comp.layer(i);
      }
    }
    throw new Error("Layer '" + layerRef + "' not found in comp '" + comp.name + "'.");
  }
  throw new Error("Invalid layer reference: " + layerRef);
}

function __findProp(layer, propName) {
  var propMap = {
    "position": "ADBE Position",
    "scale": "ADBE Scale",
    "rotation": "ADBE Rotate Z",
    "rotationx": "ADBE Rotate X",
    "rotationy": "ADBE Rotate Y",
    "rotationz": "ADBE Rotate Z",
    "opacity": "ADBE Opacity",
    "anchorpoint": "ADBE Anchor Point",
    "pointofinterest": "ADBE Point of Interest",
    "zoom": "ADBE Zoom",
    "focusdistance": "ADBE Focus Distance",
    "aperture": "ADBE Aperture",
    "blurlevel": "ADBE Blur Level"
  };

  var lower = propName.toLowerCase().replace(/\\s+/g, "");
  if (propMap[lower]) {
    var transform = layer.property("ADBE Transform Group");
    if (transform && transform.property(propMap[lower])) {
      return transform.property(propMap[lower]);
    }
    var camOptions = layer.property("ADBE Camera Options Group");
    if (camOptions && camOptions.property(propMap[lower])) {
      return camOptions.property(propMap[lower]);
    }
  }

  // Check direct property or nested path "Group/Prop"
  if (propName.indexOf("/") !== -1) {
    var parts = propName.split("/");
    var curr = layer;
    for (var p = 0; p < parts.length; p++) {
      if (!curr) break;
      curr = curr.property(parts[p]);
    }
    if (curr) return curr;
  }

  var direct = layer.property(propName);
  if (direct) return direct;

  var xform = layer.property("ADBE Transform Group");
  if (xform && xform.property(propName)) return xform.property(propName);

  // Search effects group
  var effects = layer.property("ADBE Effect Parade");
  if (effects) {
    for (var e = 1; e <= effects.numProperties; e++) {
      var eff = effects.property(e);
      if (eff.name === propName || eff.matchName === propName) return eff;
      for (var ep = 1; ep <= eff.numProperties; ep++) {
        var param = eff.property(ep);
        if (param.name === propName || param.matchName === propName) return param;
      }
    }
  }

  throw new Error("Property '" + propName + "' not found on layer '" + layer.name + "'.");
}

function __getLayerType(layer) {
  if (layer instanceof CameraLayer) return "Camera";
  if (layer instanceof LightLayer) return "Light";
  if (layer instanceof ShapeLayer) return "Shape";
  if (layer instanceof TextLayer) return "Text";
  if (layer.nullLayer) return "Null";
  if (layer.source instanceof CompItem) return "Precomp";
  if (layer.source instanceof FootageItem) {
    if (layer.source.mainSource instanceof SolidSource) return "Solid";
    return "Footage";
  }
  return "AVLayer";
}

function __setKeyTemporalEase(prop, kIdx, inEaseObj, outEaseObj) {
  var isSpatial = false;
  try {
    if (prop.propertyValueType === PropertyValueType.TwoD_SPATIAL || prop.propertyValueType === PropertyValueType.ThreeD_SPATIAL) {
      isSpatial = true;
    }
  } catch(e) {}

  if (isSpatial) {
    prop.setTemporalEaseAtKey(kIdx, [inEaseObj], [outEaseObj]);
  } else {
    var val = prop.keyValue(kIdx);
    var dims = (val instanceof Array) ? val.length : 1;
    var inArr = [], outArr = [];
    for (var d = 0; d < dims; d++) {
      inArr.push(inEaseObj);
      outArr.push(outEaseObj);
    }
    try {
      prop.setTemporalEaseAtKey(kIdx, inArr, outArr);
    } catch(err) {
      try { prop.setTemporalEaseAtKey(kIdx, [inEaseObj], [outEaseObj]); } catch(err2) {}
    }
  }
}
`;

export function scriptCreateComposition(params: {
  name: string;
  width?: number;
  height?: number;
  pixelAspectRatio?: number;
  duration?: number;
  frameRate?: number;
  bgColor?: [number, number, number];
}): string {
  const p = {
    name: params.name || 'New Composition',
    width: params.width || 1920,
    height: params.height || 1080,
    pixelAspectRatio: params.pixelAspectRatio || 1.0,
    duration: params.duration || 10.0,
    frameRate: params.frameRate || 30.0,
    bgColor: params.bgColor || [0, 0, 0],
  };

  return `(function() {
    ${ExtendScriptHelpers}
    var comp = app.project.items.addComp(
      ${JSON.stringify(p.name)},
      ${p.width},
      ${p.height},
      ${p.pixelAspectRatio},
      ${p.duration},
      ${p.frameRate}
    );
    comp.bgColor = [${p.bgColor[0]}, ${p.bgColor[1]}, ${p.bgColor[2]}];
    comp.openInViewer();
    return {
      id: comp.id,
      name: comp.name,
      width: comp.width,
      height: comp.height,
      duration: comp.duration,
      frameRate: comp.frameRate,
      numLayers: comp.numLayers
    };
  })()`;
}

export function scriptRenameComposition(params: {
  compName?: string;
  newName: string;
}): string {
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var oldName = comp.name;
    comp.name = ${JSON.stringify(params.newName)};
    return {
      success: true,
      oldName: oldName,
      newName: comp.name
    };
  })()`;
}

export function scriptSetCompositionProperties(params: {
  compName?: string;
  newName?: string;
  width?: number;
  height?: number;
  duration?: number;
  frameRate?: number;
  pixelAspectRatio?: number;
  bgColor?: [number, number, number];
}): string {
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var oldName = comp.name;

    if (${JSON.stringify(params.newName || null)} !== null) {
      comp.name = ${JSON.stringify(params.newName || '')};
    }
    if (${params.width !== undefined ? params.width : 'null'} !== null) {
      comp.width = ${params.width || 0};
    }
    if (${params.height !== undefined ? params.height : 'null'} !== null) {
      comp.height = ${params.height || 0};
    }
    if (${params.duration !== undefined ? params.duration : 'null'} !== null) {
      comp.duration = ${params.duration || 0};
    }
    if (${params.frameRate !== undefined ? params.frameRate : 'null'} !== null) {
      comp.frameRate = ${params.frameRate || 0};
    }
    if (${params.pixelAspectRatio !== undefined ? params.pixelAspectRatio : 'null'} !== null) {
      comp.pixelAspectRatio = ${params.pixelAspectRatio || 1.0};
    }
    if (${JSON.stringify(params.bgColor || null)} !== null) {
      var bg = ${JSON.stringify(params.bgColor)};
      comp.bgColor = [bg[0], bg[1], bg[2]];
    }

    return {
      success: true,
      oldName: oldName,
      name: comp.name,
      width: comp.width,
      height: comp.height,
      duration: comp.duration,
      frameRate: comp.frameRate,
      pixelAspectRatio: comp.pixelAspectRatio
    };
  })()`;
}

export function scriptSetLayerKeyframe(params: {
  compName?: string;
  layerName?: string;
  layerIndex?: number;
  propertyName: string;
  time: number;
  value: number | number[];
  keyframeInterpolation?: 'linear' | 'ease' | 'easeIn' | 'easeOut' | 'hold';
}): string {
  const layerRef = params.layerIndex !== undefined ? params.layerIndex : (params.layerName || 1);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var layer = __findLayer(comp, ${JSON.stringify(layerRef)});
    var prop = __findProp(layer, ${JSON.stringify(params.propertyName)});
    if (!prop.canVaryOverTime) {
      throw new Error("Property " + ${JSON.stringify(params.propertyName)} + " cannot be animated with keyframes.");
    }
    var time = ${params.time};
    var val = ${JSON.stringify(params.value)};
    prop.setValueAtTime(time, val);
    var keyIndex = prop.nearestKeyIndex(time);

    var interp = ${JSON.stringify(params.keyframeInterpolation || 'linear')};
    if (interp === 'hold') {
      prop.setInterpolationTypeAtKey(keyIndex, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
    } else if (interp === 'ease' || interp === 'easeIn' || interp === 'easeOut') {
      var easeInObj = new KeyframeEase(0, 33.33);
      var easeOutObj = new KeyframeEase(0, 33.33);
      if (interp === 'ease') {
        __setKeyTemporalEase(prop, keyIndex, easeInObj, easeOutObj);
      } else if (interp === 'easeIn') {
        __setKeyTemporalEase(prop, keyIndex, easeInObj, new KeyframeEase(0, 0.1));
      } else if (interp === 'easeOut') {
        __setKeyTemporalEase(prop, keyIndex, new KeyframeEase(0, 0.1), easeOutObj);
      }
    } else {
      prop.setInterpolationTypeAtKey(keyIndex, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
    }

    return {
      layerName: layer.name,
      propertyName: prop.name,
      keyIndex: keyIndex,
      time: time,
      value: val,
      interpolation: interp
    };
  })()`;
}

export function scriptSetLayerExpression(params: {
  compName?: string;
  layerName?: string;
  layerIndex?: number;
  propertyName: string;
  expression: string | null;
  enabled?: boolean;
}): string {
  const layerRef = params.layerIndex !== undefined ? params.layerIndex : (params.layerName || 1);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var layer = __findLayer(comp, ${JSON.stringify(layerRef)});
    var prop = __findProp(layer, ${JSON.stringify(params.propertyName)});
    if (!prop.canSetExpression) {
      throw new Error("Property " + ${JSON.stringify(params.propertyName)} + " does not support expressions.");
    }
    var expr = ${JSON.stringify(params.expression)};
    if (expr === null || expr === "") {
      prop.expression = "";
      prop.expressionEnabled = false;
    } else {
      prop.expression = expr;
      prop.expressionEnabled = ${params.enabled !== false ? 'true' : 'false'};
    }
    return {
      layerName: layer.name,
      propertyName: prop.name,
      expression: prop.expression,
      expressionEnabled: prop.expressionEnabled
    };
  })()`;
}

export function scriptSetLayerProperties(params: {
  compName?: string;
  layerName?: string;
  layerIndex?: number;
  properties: {
    position?: number[];
    scale?: number[];
    rotation?: number;
    rotationX?: number;
    rotationY?: number;
    rotationZ?: number;
    opacity?: number;
    blendMode?: string;
    threeDLayer?: boolean;
    trackMatteType?: string;
    enabled?: boolean;
    name?: string;
    inPoint?: number;
    outPoint?: number;
    startTime?: number;
    comment?: string;
    label?: number;
  };
}): string {
  const layerRef = params.layerIndex !== undefined ? params.layerIndex : (params.layerName || 1);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var layer = __findLayer(comp, ${JSON.stringify(layerRef)});
    var props = ${JSON.stringify(params.properties)};

    if (props.threeDLayer !== undefined) {
      layer.threeDLayer = Boolean(props.threeDLayer);
    }
    if (props.position !== undefined) {
      layer.transform.position.setValue(props.position);
    }
    if (props.scale !== undefined) {
      layer.transform.scale.setValue(props.scale);
    }
    if (props.rotation !== undefined) {
      if (layer.threeDLayer && layer.transform.zRotation) {
        layer.transform.zRotation.setValue(props.rotation);
      } else if (layer.transform.rotation) {
        layer.transform.rotation.setValue(props.rotation);
      }
    }
    if (props.rotationX !== undefined && layer.transform.xRotation) {
      layer.transform.xRotation.setValue(props.rotationX);
    }
    if (props.rotationY !== undefined && layer.transform.yRotation) {
      layer.transform.yRotation.setValue(props.rotationY);
    }
    if (props.rotationZ !== undefined && layer.transform.zRotation) {
      layer.transform.zRotation.setValue(props.rotationZ);
    }
    if (props.opacity !== undefined) {
      layer.transform.opacity.setValue(props.opacity);
    }
    if (props.enabled !== undefined) {
      layer.enabled = Boolean(props.enabled);
    }
    if (props.name !== undefined) {
      layer.name = props.name;
    }
    if (props.inPoint !== undefined) {
      layer.inPoint = props.inPoint;
    }
    if (props.outPoint !== undefined) {
      layer.outPoint = props.outPoint;
    }
    if (props.startTime !== undefined) {
      layer.startTime = props.startTime;
    }
    if (props.comment !== undefined) {
      layer.comment = props.comment;
    }
    if (props.label !== undefined) {
      layer.label = props.label;
    }
    if (props.blendMode !== undefined) {
      var bmMap = {
        "NORMAL": BlendingMode.NORMAL,
        "DISSOLVE": BlendingMode.DISSOLVE,
        "DARKEN": BlendingMode.DARKEN,
        "MULTIPLY": BlendingMode.MULTIPLY,
        "COLOR_BURN": BlendingMode.COLOR_BURN,
        "LINEAR_BURN": BlendingMode.LINEAR_BURN,
        "LIGHTEN": BlendingMode.LIGHTEN,
        "SCREEN": BlendingMode.SCREEN,
        "COLOR_DODGE": BlendingMode.COLOR_DODGE,
        "OVERLAY": BlendingMode.OVERLAY,
        "SOFT_LIGHT": BlendingMode.SOFT_LIGHT,
        "HARD_LIGHT": BlendingMode.HARD_LIGHT,
        "DIFFERENCE": BlendingMode.DIFFERENCE,
        "ADD": BlendingMode.ADD
      };
      var bmKey = props.blendMode.toUpperCase();
      if (bmMap[bmKey]) {
        layer.blendingMode = bmMap[bmKey];
      }
    }
    if (props.trackMatteType !== undefined) {
      var tmMap = {
        "NO_TRACK_MATTE": TrackMatteType.NO_TRACK_MATTE,
        "ALPHA": TrackMatteType.ALPHA,
        "ALPHA_INVERTED": TrackMatteType.ALPHA_INVERTED,
        "LUMA": TrackMatteType.LUMA,
        "LUMA_INVERTED": TrackMatteType.LUMA_INVERTED
      };
      var tmKey = props.trackMatteType.toUpperCase();
      if (tmMap[tmKey]) {
        layer.trackMatteType = tmMap[tmKey];
      }
    }

    return {
      index: layer.index,
      name: layer.name,
      threeDLayer: layer.threeDLayer,
      enabled: layer.enabled,
      position: layer.transform.position.value,
      scale: layer.transform.scale.value,
      opacity: layer.transform.opacity.value
    };
  })()`;
}

export function scriptBatchSetLayerProperties(params: {
  compName?: string;
  updates: Array<{
    layerName?: string;
    layerIndex?: number;
    properties: Record<string, any>;
  }>;
}): string {
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var updates = ${JSON.stringify(params.updates)};
    var results = [];

    for (var i = 0; i < updates.length; i++) {
      var item = updates[i];
      var layerRef = item.layerIndex !== undefined ? item.layerIndex : (item.layerName || 1);
      try {
        var layer = __findLayer(comp, layerRef);
        var props = item.properties;
        if (props.threeDLayer !== undefined) layer.threeDLayer = Boolean(props.threeDLayer);
        if (props.position !== undefined) layer.transform.position.setValue(props.position);
        if (props.scale !== undefined) layer.transform.scale.setValue(props.scale);
        if (props.rotation !== undefined) {
          if (layer.threeDLayer && layer.transform.zRotation) layer.transform.zRotation.setValue(props.rotation);
          else if (layer.transform.rotation) layer.transform.rotation.setValue(props.rotation);
        }
        if (props.opacity !== undefined) layer.transform.opacity.setValue(props.opacity);
        if (props.enabled !== undefined) layer.enabled = Boolean(props.enabled);
        if (props.name !== undefined) layer.name = props.name;
        results.push({ success: true, layerIndex: layer.index, layerName: layer.name });
      } catch (err) {
        results.push({ success: false, layerRef: layerRef, error: err.toString() });
      }
    }
    return results;
  })()`;
}

export function scriptGetLayerInfo(params: {
  compName?: string;
  layerName?: string;
  layerIndex?: number;
}): string {
  const hasSpecific = params.layerName !== undefined || params.layerIndex !== undefined;
  const layerRef = params.layerIndex !== undefined ? params.layerIndex : params.layerName;

  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});

    function extractLayer(layer) {
      var effectsList = [];
      var effects = layer.property("ADBE Effect Parade");
      if (effects) {
        for (var e = 1; e <= effects.numProperties; e++) {
          var eff = effects.property(e);
          effectsList.push({
            index: eff.propertyIndex,
            name: eff.name,
            matchName: eff.matchName,
            enabled: eff.enabled
          });
        }
      }

      var masksList = [];
      var masks = layer.property("ADBE Mask Parade");
      if (masks) {
        for (var m = 1; m <= masks.numProperties; m++) {
          var msk = masks.property(m);
          masksList.push({
            index: msk.propertyIndex,
            name: msk.name,
            inverted: msk.inverted,
            locked: msk.locked
          });
        }
      }

      var pos = null, sc = null, op = null, rot = null;
      try { if (layer.transform && layer.transform.position) pos = layer.transform.position.value; } catch(e){}
      try { if (layer.transform && layer.transform.scale) sc = layer.transform.scale.value; } catch(e){}
      try { if (layer.transform && layer.transform.opacity) op = layer.transform.opacity.value; } catch(e){}
      try {
        if (layer.threeDLayer && layer.transform.zRotation) rot = layer.transform.zRotation.value;
        else if (layer.transform && layer.transform.rotation) rot = layer.transform.rotation.value;
      } catch(e){}

      return {
        index: layer.index,
        name: layer.name,
        type: __getLayerType(layer),
        threeDLayer: Boolean(layer.threeDLayer),
        enabled: Boolean(layer.enabled),
        inPoint: layer.inPoint,
        outPoint: layer.outPoint,
        startTime: layer.startTime,
        duration: layer.outPoint - layer.inPoint,
        position: pos,
        scale: sc,
        opacity: op,
        rotation: rot,
        parentIndex: layer.parent ? layer.parent.index : null,
        parentName: layer.parent ? layer.parent.name : null,
        effects: effectsList,
        masks: masksList
      };
    }

    ${hasSpecific ? `
      var target = __findLayer(comp, ${JSON.stringify(layerRef)});
      return {
        composition: comp.name,
        layer: extractLayer(target)
      };
    ` : `
      var all = [];
      for (var l = 1; l <= comp.numLayers; l++) {
        all.push(extractLayer(comp.layer(l)));
      }
      return {
        composition: comp.name,
        totalLayers: comp.numLayers,
        layers: all
      };
    `}
  })()`;
}

export function scriptCreateCamera(params: {
  compName?: string;
  name?: string;
  cameraType?: 'one-node' | 'two-node';
  preset?: '15mm' | '20mm' | '24mm' | '28mm' | '35mm' | '50mm' | '80mm' | '135mm' | '200mm' | 'custom';
  focalLength?: number;
  zoom?: number;
  centerPoint?: [number, number];
  position?: [number, number, number];
  pointOfInterest?: [number, number, number];
  orientation?: [number, number, number];
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
  depthOfField?: boolean;
  focusDistance?: number;
  aperture?: number;
  blurLevel?: number;
  irisShape?: 'fast_rectangle' | 'triangle' | 'cross' | 'pentagon' | 'hexagon' | 'heptagon' | 'octagon';
  createRig?: boolean;
  rigName?: string;
}): string {
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var name = ${JSON.stringify(params.name || 'Camera 1')};
    var centerPoint = ${JSON.stringify(params.centerPoint)} || [comp.width/2, comp.height/2];
    var cam = comp.layers.addCamera(name, centerPoint);

    var camType = ${JSON.stringify(params.cameraType || 'two-node')};
    if (camType === 'one-node') {
      cam.autoOrient = AutoOrientType.NO_AUTO_ORIENT;
    } else {
      cam.autoOrient = AutoOrientType.CAMERA_OR_POINT_OF_INTEREST;
    }

    var focalPresets = {
      '15mm': 15, '20mm': 20, '24mm': 24, '28mm': 28,
      '35mm': 35, '50mm': 50, '80mm': 80, '135mm': 135, '200mm': 200
    };
    var fLen = ${params.focalLength || 0};
    var presetName = ${JSON.stringify(params.preset || '')};
    if (!fLen && presetName && focalPresets[presetName]) {
      fLen = focalPresets[presetName];
    }
    var targetZoom = ${params.zoom !== undefined ? params.zoom : 'null'};
    if (fLen > 0) {
      targetZoom = (fLen / 36.0) * comp.width;
    }

    var camOpts = cam.property("ADBE Camera Options Group");
    if (targetZoom !== null && targetZoom !== undefined) {
      camOpts.property("ADBE Camera Zoom").setValue(targetZoom);
    }

    if (${JSON.stringify(params.pointOfInterest)}) {
      if (cam.transform.pointOfInterest) {
        cam.transform.pointOfInterest.setValue(${JSON.stringify(params.pointOfInterest)});
      }
    }
    if (${JSON.stringify(params.position)}) {
      cam.transform.position.setValue(${JSON.stringify(params.position)});
    } else if (targetZoom !== null) {
      var poi = cam.transform.pointOfInterest ? cam.transform.pointOfInterest.value : [comp.width/2, comp.height/2, 0];
      cam.transform.position.setValue([poi[0], poi[1], poi[2] - targetZoom]);
    }

    if (${JSON.stringify(params.orientation)}) {
      cam.transform.orientation.setValue(${JSON.stringify(params.orientation)});
    }
    if (${params.rotationX !== undefined ? params.rotationX : 'null'} !== null) {
      if (cam.transform.xRotation) cam.transform.xRotation.setValue(${params.rotationX || 0});
    }
    if (${params.rotationY !== undefined ? params.rotationY : 'null'} !== null) {
      if (cam.transform.yRotation) cam.transform.yRotation.setValue(${params.rotationY || 0});
    }
    if (${params.rotationZ !== undefined ? params.rotationZ : 'null'} !== null) {
      if (cam.transform.zRotation) cam.transform.zRotation.setValue(${params.rotationZ || 0});
    }

    if (${params.depthOfField !== undefined ? Boolean(params.depthOfField) : 'null'} !== null) {
      camOpts.property("ADBE Camera Depth of Field").setValue(${params.depthOfField ? 1 : 0});
    }
    if (${params.focusDistance !== undefined ? params.focusDistance : 'null'} !== null) {
      camOpts.property("ADBE Camera Focus Distance").setValue(${params.focusDistance || 0});
    } else {
      var posV = cam.transform.position.value;
      var poiV = cam.transform.pointOfInterest ? cam.transform.pointOfInterest.value : [comp.width/2, comp.height/2, 0];
      var dx = posV[0] - poiV[0], dy = posV[1] - poiV[1], dz = posV[2] - poiV[2];
      var dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      camOpts.property("ADBE Camera Focus Distance").setValue(dist);
    }

    if (${params.aperture !== undefined ? params.aperture : 'null'} !== null) {
      camOpts.property("ADBE Camera Aperture").setValue(${params.aperture || 0});
    }
    if (${params.blurLevel !== undefined ? params.blurLevel : 'null'} !== null) {
      camOpts.property("ADBE Camera Blur Level").setValue(${params.blurLevel || 100});
    }

    var irisMap = {
      'fast_rectangle': 1, 'triangle': 2, 'cross': 3,
      'pentagon': 4, 'hexagon': 5, 'heptagon': 6, 'octagon': 7
    };
    var irisKey = ${JSON.stringify(params.irisShape || '')};
    if (irisKey && irisMap[irisKey]) {
      var irisProp = camOpts.property("ADBE Camera Iris Shape");
      if (irisProp) irisProp.setValue(irisMap[irisKey]);
    }

    var rigData = null;
    if (${Boolean(params.createRig)}) {
      var rig = comp.layers.addNull(comp.duration);
      rig.name = ${JSON.stringify(params.rigName || (params.name ? params.name + ' Controller' : 'Camera Controller'))};
      rig.threeDLayer = true;
      var rigPos = cam.transform.pointOfInterest ? cam.transform.pointOfInterest.value : [comp.width/2, comp.height/2, 0];
      rig.transform.position.setValue(rigPos);
      cam.parent = rig;
      rigData = {
        rigIndex: rig.index,
        rigName: rig.name,
        rigPosition: rig.transform.position.value
      };
    }

    return {
      index: cam.index,
      name: cam.name,
      cameraType: camType,
      position: cam.transform.position.value,
      pointOfInterest: cam.transform.pointOfInterest ? cam.transform.pointOfInterest.value : null,
      zoom: camOpts.property("ADBE Camera Zoom").value,
      depthOfField: camOpts.property("ADBE Camera Depth of Field").value === 1,
      focusDistance: camOpts.property("ADBE Camera Focus Distance").value,
      aperture: camOpts.property("ADBE Camera Aperture").value,
      rig: rigData
    };
  })()`;
}

export function scriptSetCameraProperties(params: {
  compName?: string;
  cameraName?: string;
  cameraIndex?: number;
  cameraType?: 'one-node' | 'two-node';
  position?: [number, number, number];
  pointOfInterest?: [number, number, number];
  orientation?: [number, number, number];
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
  zoom?: number;
  depthOfField?: boolean;
  focusDistance?: number;
  aperture?: number;
  blurLevel?: number;
  irisShape?: 'fast_rectangle' | 'triangle' | 'cross' | 'pentagon' | 'hexagon' | 'heptagon' | 'octagon';
  irisRotation?: number;
  irisRoundness?: number;
  irisAspectRatio?: number;
  lockFocusToLayer?: string | number;
}): string {
  const layerRef = params.cameraIndex !== undefined ? params.cameraIndex : (params.cameraName || 1);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var cam = __findLayer(comp, ${JSON.stringify(layerRef)});
    if (!(cam instanceof CameraLayer)) {
      throw new Error("Layer '" + cam.name + "' is not a CameraLayer.");
    }

    if (${JSON.stringify(params.cameraType)}) {
      if (${JSON.stringify(params.cameraType)} === 'one-node') {
        cam.autoOrient = AutoOrientType.NO_AUTO_ORIENT;
      } else {
        cam.autoOrient = AutoOrientType.CAMERA_OR_POINT_OF_INTEREST;
      }
    }

    if (${JSON.stringify(params.pointOfInterest)} && cam.transform.pointOfInterest) {
      cam.transform.pointOfInterest.setValue(${JSON.stringify(params.pointOfInterest)});
    }
    if (${JSON.stringify(params.position)}) {
      cam.transform.position.setValue(${JSON.stringify(params.position)});
    }
    if (${JSON.stringify(params.orientation)}) {
      cam.transform.orientation.setValue(${JSON.stringify(params.orientation)});
    }
    if (${params.rotationX !== undefined ? params.rotationX : 'null'} !== null && cam.transform.xRotation) {
      cam.transform.xRotation.setValue(${params.rotationX || 0});
    }
    if (${params.rotationY !== undefined ? params.rotationY : 'null'} !== null && cam.transform.yRotation) {
      cam.transform.yRotation.setValue(${params.rotationY || 0});
    }
    if (${params.rotationZ !== undefined ? params.rotationZ : 'null'} !== null && cam.transform.zRotation) {
      cam.transform.zRotation.setValue(${params.rotationZ || 0});
    }

    var camOpts = cam.property("ADBE Camera Options Group");
    if (${params.zoom !== undefined ? params.zoom : 'null'} !== null) {
      camOpts.property("ADBE Camera Zoom").setValue(${params.zoom || 0});
    }
    if (${params.depthOfField !== undefined ? Boolean(params.depthOfField) : 'null'} !== null) {
      camOpts.property("ADBE Camera Depth of Field").setValue(${params.depthOfField ? 1 : 0});
    }
    if (${params.focusDistance !== undefined ? params.focusDistance : 'null'} !== null) {
      camOpts.property("ADBE Camera Focus Distance").setValue(${params.focusDistance || 0});
    }
    if (${params.aperture !== undefined ? params.aperture : 'null'} !== null) {
      camOpts.property("ADBE Camera Aperture").setValue(${params.aperture || 0});
    }
    if (${params.blurLevel !== undefined ? params.blurLevel : 'null'} !== null) {
      camOpts.property("ADBE Camera Blur Level").setValue(${params.blurLevel || 100});
    }

    var irisMap = {
      'fast_rectangle': 1, 'triangle': 2, 'cross': 3,
      'pentagon': 4, 'hexagon': 5, 'heptagon': 6, 'octagon': 7
    };
    var irisKey = ${JSON.stringify(params.irisShape || '')};
    if (irisKey && irisMap[irisKey]) {
      var irisProp = camOpts.property("ADBE Camera Iris Shape");
      if (irisProp) irisProp.setValue(irisMap[irisKey]);
    }
    if (${params.irisRotation !== undefined ? params.irisRotation : 'null'} !== null) {
      var irRot = camOpts.property("ADBE Camera Iris Rotation");
      if (irRot) irRot.setValue(${params.irisRotation || 0});
    }
    if (${params.irisRoundness !== undefined ? params.irisRoundness : 'null'} !== null) {
      var irRnd = camOpts.property("ADBE Camera Iris Roundness");
      if (irRnd) irRnd.setValue(${params.irisRoundness || 0});
    }
    if (${params.irisAspectRatio !== undefined ? params.irisAspectRatio : 'null'} !== null) {
      var irAsp = camOpts.property("ADBE Camera Iris Aspect Ratio");
      if (irAsp) irAsp.setValue(${params.irisAspectRatio || 1});
    }

    if (${JSON.stringify(params.lockFocusToLayer)}) {
      var targetLayer = __findLayer(comp, ${JSON.stringify(params.lockFocusToLayer)});
      var fdProp = camOpts.property("ADBE Camera Focus Distance");
      fdProp.expression = 'length(position, thisComp.layer("' + targetLayer.name + '").position);';
    }

    return {
      index: cam.index,
      name: cam.name,
      position: cam.transform.position.value,
      pointOfInterest: cam.transform.pointOfInterest ? cam.transform.pointOfInterest.value : null,
      zoom: camOpts.property("ADBE Camera Zoom").value,
      depthOfField: camOpts.property("ADBE Camera Depth of Field").value === 1,
      focusDistance: camOpts.property("ADBE Camera Focus Distance").value,
      aperture: camOpts.property("ADBE Camera Aperture").value
    };
  })()`;
}

export function scriptApplyCameraMove(params: {
  compName?: string;
  cameraName?: string;
  cameraIndex?: number;
  moveType: 'orbit' | 'dolly_in' | 'dolly_out' | 'truck' | 'pedestal' | 'boom' | 'pan' | 'whip_pan' | 'dolly_zoom' | 'fly_through' | 'spiral' | 'handheld_shake';
  targetLayerName?: string;
  targetLayerIndex?: number;
  startTime?: number;
  duration?: number;
  distance?: number;
  angle?: number;
  direction?: 'left' | 'right' | 'up' | 'down' | 'clockwise' | 'counter_clockwise';
  easing?: 'cinematic' | 'dynamicSnap' | 'smooth' | 'easeIn' | 'easeOut' | 'linear';
  handheldIntensity?: 'subtle' | 'moderate' | 'intense';
}): string {
  const layerRef = params.cameraIndex !== undefined ? params.cameraIndex : (params.cameraName || 1);
  const targetLayerRef = params.targetLayerIndex !== undefined ? params.targetLayerIndex : (params.targetLayerName || null);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var cam = __findLayer(comp, ${JSON.stringify(layerRef)});
    if (!(cam instanceof CameraLayer)) {
      throw new Error("Layer '" + cam.name + "' is not a CameraLayer.");
    }

    var moveType = ${JSON.stringify(params.moveType)};
    var sTime = ${params.startTime !== undefined ? params.startTime : 0};
    var dur = ${params.duration !== undefined ? params.duration : 2.5};
    var eTime = sTime + dur;
    var easing = ${JSON.stringify(params.easing || 'cinematic')};
    var direction = ${JSON.stringify(params.direction || 'clockwise')};

    // Ease helper
    function __applyEase(prop, kIdx, inInf, outInf) {
      if (easing === 'linear') return;
      var inEaseObj = new KeyframeEase(0, inInf);
      var outEaseObj = new KeyframeEase(0, outInf);
      prop.setInterpolationTypeAtKey(kIdx, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
      __setKeyTemporalEase(prop, kIdx, inEaseObj, outEaseObj);
    }

    var inInf = 65, outInf = 65;
    if (easing === 'dynamicSnap') { inInf = 85; outInf = 15; }
    else if (easing === 'smooth') { inInf = 33.3; outInf = 33.3; }
    else if (easing === 'easeIn') { inInf = 75; outInf = 10; }
    else if (easing === 'easeOut') { inInf = 10; outInf = 75; }

    // Resolve target position
    var targetPos = [comp.width/2, comp.height/2, 0];
    if (${JSON.stringify(targetLayerRef)} !== null) {
      var tLayer = __findLayer(comp, ${JSON.stringify(targetLayerRef)});
      targetPos = tLayer.transform.position.value;
    } else if (cam.transform.pointOfInterest) {
      targetPos = cam.transform.pointOfInterest.value;
    }

    var posProp = cam.transform.position;
    var poiProp = cam.transform.pointOfInterest;
    var camOpts = cam.property("ADBE Camera Options Group");
    var zoomProp = camOpts ? camOpts.property("ADBE Camera Zoom") : null;

    if (moveType === 'handheld_shake') {
      var intensity = ${JSON.stringify(params.handheldIntensity || 'subtle')};
      var freq = 1.5;
      var ampPos = 8;
      var ampRot = 1.2;
      if (intensity === 'moderate') {
        freq = 2.2; ampPos = 22; ampRot = 2.8;
      } else if (intensity === 'intense') {
        freq = 3.5; ampPos = 45; ampRot = 6.0;
      }
      posProp.expression = "var f = " + freq + "; var a = " + ampPos + "; wiggle(f, a);";
      if (cam.transform.yRotation) cam.transform.yRotation.expression = "wiggle(" + freq + ", " + ampRot + ");";
      if (cam.transform.xRotation) cam.transform.xRotation.expression = "wiggle(" + freq + ", " + (ampRot * 0.7) + ");";
      return {
        moveType: 'handheld_shake',
        camera: cam.name,
        intensity: intensity,
        frequency: freq,
        amplitudePosition: ampPos,
        amplitudeRotation: ampRot
      };
    }

    if (moveType === 'orbit') {
      // If camera has a parent (e.g. orbit rig), simply keyframe parent Y Rotation
      if (cam.parent && cam.parent.threeDLayer) {
        var yRot = cam.parent.transform.yRotation;
        var r0 = yRot.valueAtTime(sTime, false);
        var deg = ${params.angle !== undefined ? params.angle : 90};
        if (direction === 'counter_clockwise' || direction === 'left') deg = -deg;
        var r1 = r0 + deg;
        var k1 = yRot.addKey(sTime); yRot.setValueAtKey(k1, r0);
        var k2 = yRot.addKey(eTime); yRot.setValueAtKey(k2, r1);
        __applyEase(yRot, k1, inInf, outInf);
        __applyEase(yRot, k2, inInf, outInf);
        return { moveType: 'orbit', camera: cam.name, parentRig: cam.parent.name, deltaAngle: deg, startTime: sTime, endTime: eTime };
      }

      // Standalone camera orbit around target in X-Z plane
      var p0 = posProp.valueAtTime(sTime, false);
      var dx = p0[0] - targetPos[0];
      var dz = p0[2] - targetPos[2];
      var radius = Math.sqrt(dx*dx + dz*dz);
      if (radius < 20) radius = 1000;
      var startAngle = Math.atan2(dx, -dz);
      var degDelta = ${params.angle !== undefined ? params.angle : 90};
      if (direction === 'counter_clockwise' || direction === 'left') degDelta = -degDelta;
      var totalRad = (degDelta * Math.PI) / 180.0;

      // Ensure Point of Interest is locked on target
      if (poiProp) {
        var pk1 = poiProp.addKey(sTime); poiProp.setValueAtKey(pk1, targetPos);
        var pk2 = poiProp.addKey(eTime); poiProp.setValueAtKey(pk2, targetPos);
      }

      // Add start, mid, end keyframes to preserve smooth circular arc
      var kStart = posProp.addKey(sTime);
      posProp.setValueAtKey(kStart, p0);

      var midTime = sTime + dur * 0.5;
      var midAngle = startAngle + totalRad * 0.5;
      var pMid = [targetPos[0] + radius * Math.sin(midAngle), p0[1], targetPos[2] - radius * Math.cos(midAngle)];
      var kMid = posProp.addKey(midTime);
      posProp.setValueAtKey(kMid, pMid);

      var endAngle = startAngle + totalRad;
      var pEnd = [targetPos[0] + radius * Math.sin(endAngle), p0[1], targetPos[2] - radius * Math.cos(endAngle)];
      var kEnd = posProp.addKey(eTime);
      posProp.setValueAtKey(kEnd, pEnd);

      __applyEase(posProp, kStart, inInf, outInf);
      __applyEase(posProp, kMid, inInf, outInf);
      __applyEase(posProp, kEnd, inInf, outInf);

      return { moveType: 'orbit', camera: cam.name, radius: radius, angle: degDelta, startTime: sTime, endTime: eTime };
    }

    if (moveType === 'dolly_in' || moveType === 'dolly_out') {
      var p0 = posProp.valueAtTime(sTime, false);
      var vx = targetPos[0] - p0[0], vy = targetPos[1] - p0[1], vz = targetPos[2] - p0[2];
      var len = Math.sqrt(vx*vx + vy*vy + vz*vz);
      if (len < 1) len = 1;
      var dist = ${params.distance !== undefined ? params.distance : 0};
      if (!dist) dist = len * 0.5; // default 50% push
      if (moveType === 'dolly_out') dist = -dist;

      var ux = vx/len, uy = vy/len, uz = vz/len;
      var p1 = [p0[0] + ux * dist, p0[1] + uy * dist, p0[2] + uz * dist];

      var k1 = posProp.addKey(sTime); posProp.setValueAtKey(k1, p0);
      var k2 = posProp.addKey(eTime); posProp.setValueAtKey(k2, p1);
      __applyEase(posProp, k1, inInf, outInf);
      __applyEase(posProp, k2, inInf, outInf);

      return { moveType: moveType, camera: cam.name, startPos: p0, endPos: p1, distance: dist, startTime: sTime, endTime: eTime };
    }

    if (moveType === 'truck') {
      // Horizontal slide
      var dist = ${params.distance !== undefined ? params.distance : 600};
      if (direction === 'left') dist = -dist;
      var p0 = posProp.valueAtTime(sTime, false);
      var p1 = [p0[0] + dist, p0[1], p0[2]];
      var k1 = posProp.addKey(sTime); posProp.setValueAtKey(k1, p0);
      var k2 = posProp.addKey(eTime); posProp.setValueAtKey(k2, p1);
      __applyEase(posProp, k1, inInf, outInf);
      __applyEase(posProp, k2, inInf, outInf);

      if (poiProp) {
        var poi0 = poiProp.valueAtTime(sTime, false);
        var poi1 = [poi0[0] + dist, poi0[1], poi0[2]];
        var pk1 = poiProp.addKey(sTime); poiProp.setValueAtKey(pk1, poi0);
        var pk2 = poiProp.addKey(eTime); poiProp.setValueAtKey(pk2, poi1);
        __applyEase(poiProp, pk1, inInf, outInf);
        __applyEase(poiProp, pk2, inInf, outInf);
      }
      return { moveType: 'truck', camera: cam.name, distance: dist, startTime: sTime, endTime: eTime };
    }

    if (moveType === 'pedestal' || moveType === 'boom') {
      // Vertical slide
      var dist = ${params.distance !== undefined ? params.distance : 400};
      if (direction === 'up') dist = -dist; // AE Y goes downwards
      var p0 = posProp.valueAtTime(sTime, false);
      var p1 = [p0[0], p0[1] + dist, p0[2]];
      var k1 = posProp.addKey(sTime); posProp.setValueAtKey(k1, p0);
      var k2 = posProp.addKey(eTime); posProp.setValueAtKey(k2, p1);
      __applyEase(posProp, k1, inInf, outInf);
      __applyEase(posProp, k2, inInf, outInf);

      if (poiProp) {
        var poi0 = poiProp.valueAtTime(sTime, false);
        var poi1 = [poi0[0], poi0[1] + dist, poi0[2]];
        var pk1 = poiProp.addKey(sTime); poiProp.setValueAtKey(pk1, poi0);
        var pk2 = poiProp.addKey(eTime); poiProp.setValueAtKey(pk2, poi1);
        __applyEase(poiProp, pk1, inInf, outInf);
        __applyEase(poiProp, pk2, inInf, outInf);
      }
      return { moveType: 'pedestal', camera: cam.name, distance: dist, startTime: sTime, endTime: eTime };
    }

    if (moveType === 'pan' || moveType === 'whip_pan') {
      var angle = ${params.angle !== undefined ? params.angle : (params.moveType === 'whip_pan' ? 45 : 30)};
      if (direction === 'left') angle = -angle;
      var snapInfIn = moveType === 'whip_pan' ? 90 : inInf;
      var snapInfOut = moveType === 'whip_pan' ? 10 : outInf;

      if (cam.transform.yRotation) {
        var rProp = cam.transform.yRotation;
        var r0 = rProp.valueAtTime(sTime, false);
        var r1 = r0 + angle;
        var k1 = rProp.addKey(sTime); rProp.setValueAtKey(k1, r0);
        var k2 = rProp.addKey(eTime); rProp.setValueAtKey(k2, r1);
        __applyEase(rProp, k1, snapInfIn, snapInfOut);
        __applyEase(rProp, k2, snapInfIn, snapInfOut);
      } else if (poiProp) {
        var poi0 = poiProp.valueAtTime(sTime, false);
        var offsetPan = angle * 20;
        var poi1 = [poi0[0] + offsetPan, poi0[1], poi0[2]];
        var pk1 = poiProp.addKey(sTime); poiProp.setValueAtKey(pk1, poi0);
        var pk2 = poiProp.addKey(eTime); poiProp.setValueAtKey(pk2, poi1);
        __applyEase(poiProp, pk1, snapInfIn, snapInfOut);
        __applyEase(poiProp, pk2, snapInfIn, snapInfOut);
      }
      return { moveType: moveType, camera: cam.name, angle: angle, startTime: sTime, endTime: eTime };
    }

    if (moveType === 'dolly_zoom') {
      if (!zoomProp) throw new Error("Camera Zoom property not accessible for dolly zoom.");
      var p0 = posProp.valueAtTime(sTime, false);
      var z0 = zoomProp.valueAtTime(sTime, false);
      var vx = targetPos[0] - p0[0], vy = targetPos[1] - p0[1], vz = targetPos[2] - p0[2];
      var d0 = Math.sqrt(vx*vx + vy*vy + vz*vz);
      if (d0 < 50) d0 = 500;
      var pushDist = ${params.distance !== undefined ? params.distance : 0};
      if (!pushDist) pushDist = d0 * 0.45;
      if (direction === 'dolly_out') pushDist = -pushDist;

      var d1 = d0 - pushDist;
      if (d1 < 50) d1 = 50;
      var z1 = z0 * (d1 / d0); // Exact perspective counter-scaling formula

      var ux = vx/d0, uy = vy/d0, uz = vz/d0;
      var p1 = [p0[0] + ux * pushDist, p0[1] + uy * pushDist, p0[2] + uz * pushDist];

      var kp1 = posProp.addKey(sTime); posProp.setValueAtKey(kp1, p0);
      var kp2 = posProp.addKey(eTime); posProp.setValueAtKey(kp2, p1);
      var kz1 = zoomProp.addKey(sTime); zoomProp.setValueAtKey(kz1, z0);
      var kz2 = zoomProp.addKey(eTime); zoomProp.setValueAtKey(kz2, z1);

      __applyEase(posProp, kp1, inInf, outInf);
      __applyEase(posProp, kp2, inInf, outInf);
      __applyEase(zoomProp, kz1, inInf, outInf);
      __applyEase(zoomProp, kz2, inInf, outInf);

      return { moveType: 'dolly_zoom', camera: cam.name, initialDistance: d0, finalDistance: d1, initialZoom: z0, finalZoom: z1, startTime: sTime, endTime: eTime };
    }

    if (moveType === 'fly_through') {
      var p0 = posProp.valueAtTime(sTime, false);
      var vx = targetPos[0] - p0[0], vy = targetPos[1] - p0[1], vz = targetPos[2] - p0[2];
      var d = Math.sqrt(vx*vx + vy*vy + vz*vz);
      if (d < 50) d = 800;
      var ux = vx/d, uy = vy/d, uz = vz/d;
      var overDist = d + ( ${params.distance !== undefined ? params.distance : 800} );
      var p1 = [p0[0] + ux * overDist, p0[1] + uy * overDist, p0[2] + uz * overDist];

      var k1 = posProp.addKey(sTime); posProp.setValueAtKey(k1, p0);
      var k2 = posProp.addKey(eTime); posProp.setValueAtKey(k2, p1);
      __applyEase(posProp, k1, inInf, outInf);
      __applyEase(posProp, k2, inInf, outInf);

      return { moveType: 'fly_through', camera: cam.name, flyPastDistance: overDist, startTime: sTime, endTime: eTime };
    }

    if (moveType === 'spiral') {
      var p0 = posProp.valueAtTime(sTime, false);
      var dx = p0[0] - targetPos[0], dz = p0[2] - targetPos[2];
      var r0 = Math.sqrt(dx*dx + dz*dz);
      if (r0 < 20) r0 = 1000;
      var r1 = r0 * 0.5; // spiral closer to 50%
      var startAngle = Math.atan2(dx, -dz);
      var degDelta = ${params.angle !== undefined ? params.angle : 180};
      if (direction === 'counter_clockwise' || direction === 'left') degDelta = -degDelta;
      var totalRad = (degDelta * Math.PI) / 180.0;

      if (poiProp) {
        var pk1 = poiProp.addKey(sTime); poiProp.setValueAtKey(pk1, targetPos);
        var pk2 = poiProp.addKey(eTime); poiProp.setValueAtKey(pk2, targetPos);
      }

      var kStart = posProp.addKey(sTime); posProp.setValueAtKey(kStart, p0);
      var midTime = sTime + dur * 0.5;
      var midAngle = startAngle + totalRad * 0.5;
      var rMid = (r0 + r1) * 0.5;
      var pMid = [targetPos[0] + rMid * Math.sin(midAngle), p0[1], targetPos[2] - rMid * Math.cos(midAngle)];
      var kMid = posProp.addKey(midTime); posProp.setValueAtKey(kMid, pMid);

      var endAngle = startAngle + totalRad;
      var pEnd = [targetPos[0] + r1 * Math.sin(endAngle), p0[1], targetPos[2] - r1 * Math.cos(endAngle)];
      var kEnd = posProp.addKey(eTime); posProp.setValueAtKey(kEnd, pEnd);

      __applyEase(posProp, kStart, inInf, outInf);
      __applyEase(posProp, kMid, inInf, outInf);
      __applyEase(posProp, kEnd, inInf, outInf);

      return { moveType: 'spiral', camera: cam.name, startRadius: r0, endRadius: r1, angle: degDelta, startTime: sTime, endTime: eTime };
    }

    throw new Error("Unsupported camera moveType: " + moveType);
  })()`;
}

export function scriptCreateCameraRig(params: {
  compName?: string;
  cameraName?: string;
  rigName?: string;
  targetPosition?: [number, number, number];
  distance?: number;
}): string {
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var rigBaseName = ${JSON.stringify(params.rigName || 'Camera Rig')};
    var targetP = ${JSON.stringify(params.targetPosition)} || [comp.width/2, comp.height/2, 0];
    var dist = ${params.distance !== undefined ? params.distance : 1500};

    // 1. Create Target Null
    var targetNull = comp.layers.addNull(comp.duration);
    targetNull.name = rigBaseName + " Target";
    targetNull.threeDLayer = true;
    targetNull.transform.position.setValue(targetP);

    // 2. Create Orbit Null parented to Target Null
    var orbitNull = comp.layers.addNull(comp.duration);
    orbitNull.name = rigBaseName + " Orbit Controller";
    orbitNull.threeDLayer = true;
    orbitNull.transform.position.setValue(targetP);
    orbitNull.parent = targetNull;

    // 3. Create Camera
    var camName = ${JSON.stringify(params.cameraName)} || (rigBaseName + ' Camera');
    var cam = comp.layers.addCamera(camName, [comp.width/2, comp.height/2]);
    cam.autoOrient = AutoOrientType.NO_AUTO_ORIENT;
    cam.parent = orbitNull;
    cam.transform.position.setValue([0, 0, -dist]);
    cam.transform.orientation.setValue([0, 0, 0]);
    cam.transform.xRotation.setValue(0);
    cam.transform.yRotation.setValue(0);
    cam.transform.zRotation.setValue(0);

    return {
      targetNull: { index: targetNull.index, name: targetNull.name, position: targetNull.transform.position.value },
      orbitNull: { index: orbitNull.index, name: orbitNull.name },
      camera: { index: cam.index, name: cam.name, localPosition: cam.transform.position.value }
    };
  })()`;
}

export function scriptTrackCameraToLayer(params: {
  compName?: string;
  cameraName?: string;
  cameraIndex?: number;
  targetLayerName?: string;
  targetLayerIndex?: number;
  trackMode?: 'look_at' | 'follow_position' | 'focus_distance';
}): string {
  const layerRef = params.cameraIndex !== undefined ? params.cameraIndex : (params.cameraName || 1);
  const targetLayerRef = params.targetLayerIndex !== undefined ? params.targetLayerIndex : (params.targetLayerName || 2);
  const mode = params.trackMode || 'look_at';
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var cam = __findLayer(comp, ${JSON.stringify(layerRef)});
    if (!(cam instanceof CameraLayer)) {
      throw new Error("Layer '" + cam.name + "' is not a CameraLayer.");
    }
    var target = __findLayer(comp, ${JSON.stringify(targetLayerRef)});

    var trackMode = ${JSON.stringify(mode)};
    if (trackMode === 'look_at') {
      if (cam.transform.pointOfInterest) {
        cam.autoOrient = AutoOrientType.CAMERA_OR_POINT_OF_INTEREST;
        cam.transform.pointOfInterest.expression = 'thisComp.layer("' + target.name + '").position;';
      } else {
        cam.autoOrient = AutoOrientType.NO_AUTO_ORIENT;
        cam.transform.position.expression = 'lookAt(position, thisComp.layer("' + target.name + '").position);';
      }
    } else if (trackMode === 'follow_position') {
      cam.transform.position.expression = 'var tgt = thisComp.layer("' + target.name + '").position; var offset = value - tgt.valueAtTime(0); tgt + offset;';
    } else if (trackMode === 'focus_distance') {
      var camOpts = cam.property("ADBE Camera Options Group");
      if (camOpts) {
        var fd = camOpts.property("ADBE Camera Focus Distance");
        if (fd) fd.expression = 'length(position, thisComp.layer("' + target.name + '").position);';
      }
    }

    return {
      camera: cam.name,
      targetLayer: target.name,
      trackMode: trackMode
    };
  })()`;
}

export function scriptCreateNullObject(params: {
  compName?: string;
  name?: string;
  duration?: number;
}): string {
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var dur = ${params.duration || 'comp.duration'};
    var nullLayer = comp.layers.addNull(dur);
    if (${JSON.stringify(params.name)}) {
      nullLayer.name = ${JSON.stringify(params.name)};
    }
    return {
      index: nullLayer.index,
      name: nullLayer.name,
      duration: nullLayer.outPoint - nullLayer.inPoint
    };
  })()`;
}

export function scriptDuplicateLayer(params: {
  compName?: string;
  layerName?: string;
  layerIndex?: number;
}): string {
  const layerRef = params.layerIndex !== undefined ? params.layerIndex : (params.layerName || 1);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var layer = __findLayer(comp, ${JSON.stringify(layerRef)});
    var dup = layer.duplicate();
    return {
      originalIndex: layer.index,
      newIndex: dup.index,
      name: dup.name
    };
  })()`;
}

export function scriptDeleteLayer(params: {
  compName?: string;
  layerName?: string;
  layerIndex?: number;
}): string {
  const layerRef = params.layerIndex !== undefined ? params.layerIndex : (params.layerName || 1);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var layer = __findLayer(comp, ${JSON.stringify(layerRef)});
    var name = layer.name;
    var idx = layer.index;
    layer.remove();
    return {
      deletedIndex: idx,
      deletedName: name,
      remainingLayers: comp.numLayers
    };
  })()`;
}

export function scriptPrecomposeLayers(params: {
  compName?: string;
  layerIndices?: number[];
  layerNames?: string[];
  precompName: string;
}): string {
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var indices = [];

    if (${JSON.stringify(params.layerIndices || null)} !== null) {
      indices = ${JSON.stringify(params.layerIndices || [])};
    } else if (${JSON.stringify(params.layerNames || null)} !== null) {
      var names = ${JSON.stringify(params.layerNames || [])};
      for (var n = 0; n < names.length; n++) {
        var l = __findLayer(comp, names[n]);
        indices.push(l.index);
      }
    } else {
      // Use selected layers
      if (comp.selectedLayers.length === 0) {
        throw new Error("No layers selected to precompose.");
      }
      for (var s = 0; s < comp.selectedLayers.length; s++) {
        indices.push(comp.selectedLayers[s].index);
      }
    }

    if (indices.length === 0) {
      throw new Error("No layers specified to precompose.");
    }

    var precompName = ${JSON.stringify(params.precompName || 'Pre-comp 1')};
    // comp.layers.precompose(layerIndices, name, moveAllAttributes)
    var precomp = comp.layers.precompose(indices, precompName, true);

    return {
      success: true,
      precompName: precomp.name,
      precompLayersCount: precomp.numLayers,
      parentCompName: comp.name
    };
  })()`;
}

export function scriptReorderLayer(params: {
  compName?: string;
  layerName?: string;
  layerIndex?: number;
  operation: 'moveBefore' | 'moveAfter' | 'moveToBeginning' | 'moveToEnd' | 'setIndex';
  targetLayerName?: string;
  targetLayerIndex?: number;
  newIndex?: number;
}): string {
  const layerRef = params.layerIndex !== undefined ? params.layerIndex : (params.layerName || 1);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var layer = __findLayer(comp, ${JSON.stringify(layerRef)});
    var op = ${JSON.stringify(params.operation)};
    var oldIndex = layer.index;

    if (op === 'moveToBeginning') {
      layer.moveToBeginning();
    } else if (op === 'moveToEnd') {
      layer.moveToEnd();
    } else if (op === 'moveBefore') {
      var targetRef = ${JSON.stringify(params.targetLayerIndex !== undefined ? params.targetLayerIndex : (params.targetLayerName || null))};
      if (targetRef === null) throw new Error("targetLayerName or targetLayerIndex is required for moveBefore.");
      var targetLay = __findLayer(comp, targetRef);
      layer.moveBefore(targetLay);
    } else if (op === 'moveAfter') {
      var targetRef = ${JSON.stringify(params.targetLayerIndex !== undefined ? params.targetLayerIndex : (params.targetLayerName || null))};
      if (targetRef === null) throw new Error("targetLayerName or targetLayerIndex is required for moveAfter.");
      var targetLay = __findLayer(comp, targetRef);
      layer.moveAfter(targetLay);
    } else if (op === 'setIndex') {
      var targetIdx = ${params.newIndex !== undefined ? params.newIndex : 'null'};
      if (targetIdx === null) throw new Error("newIndex is required for setIndex operation.");
      if (targetIdx < 1) targetIdx = 1;
      if (targetIdx > comp.numLayers) targetIdx = comp.numLayers;
      var targetLay = comp.layer(targetIdx);
      if (targetIdx < oldIndex) {
        layer.moveBefore(targetLay);
      } else if (targetIdx > oldIndex) {
        layer.moveAfter(targetLay);
      }
    } else {
      throw new Error("Unknown operation: " + op);
    }

    return {
      success: true,
      layerName: layer.name,
      oldIndex: oldIndex,
      newIndex: layer.index,
      operation: op
    };
  })()`;
}

export function scriptSetLayerMask(params: {
  compName?: string;
  layerName?: string;
  layerIndex?: number;
  maskName?: string;
  maskIndex?: number;
  maskShape?: {
    vertices: [number, number][];
    inTangents?: [number, number][];
    outTangents?: [number, number][];
    closed?: boolean;
  };
  maskMode?: 'add' | 'subtract' | 'intersect' | 'lighten' | 'darken' | 'difference' | 'none';
  maskFeather?: [number, number];
  maskOpacity?: number;
  maskExpansion?: number;
  inverted?: boolean;
}): string {
  const layerRef = params.layerIndex !== undefined ? params.layerIndex : (params.layerName || 1);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var layer = __findLayer(comp, ${JSON.stringify(layerRef)});
    var masks = layer.property("ADBE Mask Parade");
    if (!masks) {
      throw new Error("Layer does not support masks.");
    }

    var mask = null;
    if (${params.maskIndex !== undefined ? params.maskIndex : 'null'} !== null) {
      mask = masks.property(${params.maskIndex || 1});
    } else if (${JSON.stringify(params.maskName)}) {
      for (var m = 1; m <= masks.numProperties; m++) {
        if (masks.property(m).name === ${JSON.stringify(params.maskName)}) {
          mask = masks.property(m);
          break;
        }
      }
    }

    if (!mask) {
      mask = masks.addProperty("ADBE Mask Atom");
      if (${JSON.stringify(params.maskName)}) {
        mask.name = ${JSON.stringify(params.maskName)};
      }
    }

    var shapeData = ${JSON.stringify(params.maskShape || null)};
    if (shapeData && shapeData.vertices) {
      var shape = new Shape();
      shape.vertices = shapeData.vertices;
      if (shapeData.inTangents) shape.inTangents = shapeData.inTangents;
      if (shapeData.outTangents) shape.outTangents = shapeData.outTangents;
      shape.closed = shapeData.closed !== undefined ? shapeData.closed : true;
      mask.property("ADBE Mask Shape").setValue(shape);
    }

    if (${JSON.stringify(params.maskMode)}) {
      var modeMap = {
        "none": MaskMode.NONE,
        "add": MaskMode.ADD,
        "subtract": MaskMode.SUBTRACT,
        "intersect": MaskMode.INTERSECT,
        "lighten": MaskMode.LIGHTEN,
        "darken": MaskMode.DARKEN,
        "difference": MaskMode.DIFFERENCE
      };
      var targetMode = modeMap[${JSON.stringify(params.maskMode || 'add')}.toLowerCase()];
      if (targetMode !== undefined) mask.maskMode = targetMode;
    }

    if (${params.inverted !== undefined ? params.inverted : 'null'} !== null) {
      mask.inverted = ${Boolean(params.inverted)};
    }
    if (${params.maskOpacity !== undefined ? params.maskOpacity : 'null'} !== null) {
      mask.property("ADBE Mask Opacity").setValue(${params.maskOpacity || 100});
    }
    if (${JSON.stringify(params.maskFeather)}) {
      mask.property("ADBE Mask Feather").setValue(${JSON.stringify(params.maskFeather)});
    }
    if (${params.maskExpansion !== undefined ? params.maskExpansion : 'null'} !== null) {
      mask.property("ADBE Mask Offset").setValue(${params.maskExpansion || 0});
    }

    return {
      layerName: layer.name,
      maskIndex: mask.propertyIndex,
      maskName: mask.name,
      inverted: mask.inverted
    };
  })()`;
}

export function scriptGetInstalledPlugins(params: {
  category?: string;
  search?: string;
}): string {
  return `(function() {
    ${ExtendScriptHelpers}
    // Create temporary comp to probe effect matchNames and available effects
    var effectsList = [];
    var knownCommon = [
      { name: "Gaussian Blur", matchName: "ADBE Gaussian Blur 2", category: "Blur & Sharpen" },
      { name: "Fast Box Blur", matchName: "ADBE Box Blur2", category: "Blur & Sharpen" },
      { name: "Directional Blur", matchName: "ADBE Motion Blur", category: "Blur & Sharpen" },
      { name: "Camera Lens Blur", matchName: "ADBE Camera Lens Blur", category: "Blur & Sharpen" },
      { name: "Curves", matchName: "ADBE CurvesCustom", category: "Color Correction" },
      { name: "Color Balance", matchName: "ADBE Color Balance (HLS)", category: "Color Correction" },
      { name: "Hue/Saturation", matchName: "ADBE HUE SATURATION", category: "Color Correction" },
      { name: "Brightness & Contrast", matchName: "ADBE Brightness & Contrast 2", category: "Color Correction" },
      { name: "Exposure", matchName: "ADBE Exposure2", category: "Color Correction" },
      { name: "Tint", matchName: "ADBE Tint", category: "Color Correction" },
      { name: "Tritone", matchName: "ADBE Tritone", category: "Color Correction" },
      { name: "Levels", matchName: "ADBE Pro Levels2", category: "Color Correction" },
      { name: "Lumetri Color", matchName: "ADBE Lumetri", category: "Color Correction" },
      { name: "Glow", matchName: "ADBE Glow2", category: "Stylize" },
      { name: "Drop Shadow", matchName: "ADBE Drop Shadow", category: "Perspective" },
      { name: "Transform", matchName: "ADBE Geometry2", category: "Distort" },
      { name: "Turbulent Displace", matchName: "ADBE Turbulent Displace", category: "Distort" },
      { name: "Ripple", matchName: "ADBE Ripple", category: "Distort" },
      { name: "Optics Compensation", matchName: "ADBE Optics Compensation", category: "Distort" },
      { name: "Slider Control", matchName: "ADBE Slider Control", category: "Expression Controls" },
      { name: "Color Control", matchName: "ADBE Color Control", category: "Expression Controls" },
      { name: "Point Control", matchName: "ADBE Point Control", category: "Expression Controls" },
      { name: "Checkbox Control", matchName: "ADBE Checkbox Control", category: "Expression Controls" },
      { name: "Fill", matchName: "ADBE Fill", category: "Generate" },
      { name: "Gradient Ramp", matchName: "ADBE Ramp", category: "Generate" },
      { name: "Fractal Noise", matchName: "ADBE Fractal Noise", category: "Noise & Grain" }
    ];

    // Check if test layer can accept effects
    var tempComp = app.project.items.addComp("__Probe_Comp__", 100, 100, 1, 1, 30);
    var tempSolid = tempComp.layers.addSolid([1,1,1], "Probe", 100, 100, 1);
    var effectParade = tempSolid.property("ADBE Effect Parade");

    var searchStr = ${JSON.stringify(params.search ? params.search.toLowerCase() : "")};
    var catStr = ${JSON.stringify(params.category ? params.category.toLowerCase() : "")};

    for (var i = 0; i < knownCommon.length; i++) {
      var item = knownCommon[i];
      if (searchStr && item.name.toLowerCase().indexOf(searchStr) === -1 && item.matchName.toLowerCase().indexOf(searchStr) === -1) {
        continue;
      }
      if (catStr && item.category.toLowerCase().indexOf(catStr) === -1) {
        continue;
      }

      var available = false;
      try {
        var eff = effectParade.addProperty(item.matchName);
        if (eff) {
          available = true;
          eff.remove();
        }
      } catch(e) {
        // Not installed or matchName differs
      }

      effectsList.push({
        name: item.name,
        matchName: item.matchName,
        category: item.category,
        available: available
      });
    }

    tempComp.remove();
    return {
      count: effectsList.length,
      effects: effectsList,
      note: "You can apply any installed AE plugin (e.g., Trapcode, Element 3D, Sapphire, Boris FX, Deep Glow) by passing its exact display name or matchName to applyEffect."
    };
  })()`;
}

export function scriptApplyEffect(params: {
  compName?: string;
  layerName?: string;
  layerIndex?: number;
  effectName: string;
  properties?: Record<string, any>;
}): string {
  const layerRef = params.layerIndex !== undefined ? params.layerIndex : (params.layerName || 1);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var layer = __findLayer(comp, ${JSON.stringify(layerRef)});
    var effects = layer.property("ADBE Effect Parade");
    if (!effects) {
      throw new Error("Layer does not support effects.");
    }

    var effectName = ${JSON.stringify(params.effectName)};
    var eff = null;

    // Try adding by matchName or name
    try {
      eff = effects.addProperty(effectName);
    } catch (e1) {
      // Try searching standard variations
      throw new Error("Failed to apply effect '" + effectName + "': " + e1.toString());
    }

    var initialProps = ${JSON.stringify(params.properties || {})};
    for (var key in initialProps) {
      if (initialProps.hasOwnProperty(key)) {
        try {
          var p = eff.property(key);
          if (p && p.setValue) {
            p.setValue(initialProps[key]);
          }
        } catch(e2) {
          // ignore individual property failure
        }
      }
    }

    return {
      layerName: layer.name,
      effectIndex: eff.propertyIndex,
      effectName: eff.name,
      matchName: eff.matchName,
      enabled: eff.enabled
    };
  })()`;
}

export function scriptSetEffectProperties(params: {
  compName?: string;
  layerName?: string;
  layerIndex?: number;
  effectName?: string;
  effectIndex?: number;
  properties: Record<string, any>;
}): string {
  const layerRef = params.layerIndex !== undefined ? params.layerIndex : (params.layerName || 1);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var layer = __findLayer(comp, ${JSON.stringify(layerRef)});
    var effects = layer.property("ADBE Effect Parade");
    if (!effects) {
      throw new Error("Layer does not have an effects group.");
    }

    var eff = null;
    if (${params.effectIndex !== undefined ? params.effectIndex : 'null'} !== null) {
      eff = effects.property(${params.effectIndex || 1});
    } else if (${JSON.stringify(params.effectName)}) {
      var effTarget = ${JSON.stringify(params.effectName)};
      for (var i = 1; i <= effects.numProperties; i++) {
        var candidate = effects.property(i);
        if (candidate.name === effTarget || candidate.matchName === effTarget) {
          eff = candidate;
          break;
        }
      }
    }

    if (!eff) {
      throw new Error("Effect not found on layer.");
    }

    var props = ${JSON.stringify(params.properties)};
    var updated = [];
    var errors = [];

    for (var key in props) {
      if (props.hasOwnProperty(key)) {
        try {
          var p = eff.property(key);
          if (!p) {
            // Search inside effect
            for (var j = 1; j <= eff.numProperties; j++) {
              if (eff.property(j).name === key || eff.property(j).matchName === key) {
                p = eff.property(j);
                break;
              }
            }
          }

          if (p && p.setValue) {
            var val = props[key];
            if (val && typeof val === "object" && val.time !== undefined && val.value !== undefined) {
              p.setValueAtTime(val.time, val.value);
            } else {
              p.setValue(val);
            }
            updated.push({ name: p.name, value: p.value });
          } else {
            errors.push("Property '" + key + "' not found or cannot be set.");
          }
        } catch(err) {
          errors.push("Error setting '" + key + "': " + err.toString());
        }
      }
    }

    return {
      layerName: layer.name,
      effectName: eff.name,
      updatedProperties: updated,
      errors: errors
    };
  })()`;
}

export function scriptGetEffectProperties(params: {
  compName?: string;
  layerName?: string;
  layerIndex?: number;
  effectName?: string;
  effectIndex?: number;
}): string {
  const layerRef = params.layerIndex !== undefined ? params.layerIndex : (params.layerName || 1);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var layer = __findLayer(comp, ${JSON.stringify(layerRef)});
    var effects = layer.property("ADBE Effect Parade");
    if (!effects) throw new Error("No effects on layer.");

    var eff = null;
    if (${params.effectIndex !== undefined ? params.effectIndex : 'null'} !== null) {
      eff = effects.property(${params.effectIndex || 1});
    } else if (${JSON.stringify(params.effectName)}) {
      var effTarget = ${JSON.stringify(params.effectName)};
      for (var i = 1; i <= effects.numProperties; i++) {
        var candidate = effects.property(i);
        if (candidate.name === effTarget || candidate.matchName === effTarget) {
          eff = candidate;
          break;
        }
      }
    }

    if (!eff) throw new Error("Effect not found.");

    var paramsList = [];
    for (var p = 1; p <= eff.numProperties; p++) {
      var prop = eff.property(p);
      var currentVal = null;
      try { currentVal = prop.value; } catch(e){}
      paramsList.push({
        index: prop.propertyIndex,
        name: prop.name,
        matchName: prop.matchName,
        propertyType: prop.propertyType,
        canVaryOverTime: prop.canVaryOverTime,
        value: currentVal
      });
    }

    return {
      layerName: layer.name,
      effectIndex: eff.propertyIndex,
      effectName: eff.name,
      matchName: eff.matchName,
      properties: paramsList
    };
  })()`;
}

export function scriptRemoveEffect(params: {
  compName?: string;
  layerName?: string;
  layerIndex?: number;
  effectName?: string;
  effectIndex?: number;
}): string {
  const layerRef = params.layerIndex !== undefined ? params.layerIndex : (params.layerName || 1);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var layer = __findLayer(comp, ${JSON.stringify(layerRef)});
    var effects = layer.property("ADBE Effect Parade");
    if (!effects) throw new Error("No effects on layer.");

    var eff = null;
    if (${params.effectIndex !== undefined ? params.effectIndex : 'null'} !== null) {
      eff = effects.property(${params.effectIndex || 1});
    } else if (${JSON.stringify(params.effectName)}) {
      var effTarget = ${JSON.stringify(params.effectName)};
      for (var i = 1; i <= effects.numProperties; i++) {
        var candidate = effects.property(i);
        if (candidate.name === effTarget || candidate.matchName === effTarget) {
          eff = candidate;
          break;
        }
      }
    }

    if (!eff) throw new Error("Effect not found.");
    var name = eff.name;
    var idx = eff.propertyIndex;
    eff.remove();
    return {
      removedIndex: idx,
      removedName: name,
      remainingEffects: effects.numProperties
    };
  })()`;
}

export function scriptCreateTextLayer(params: {
  compName?: string;
  text: string;
  name?: string;
  isThreeD?: boolean;
  fontSize?: number;
  font?: string;
  fillColor?: [number, number, number];
  color?: [number, number, number];
  applyFill?: boolean;
  strokeColor?: [number, number, number];
  strokeWidth?: number;
  applyStroke?: boolean;
  strokeOverFill?: boolean;
  tracking?: number;
  leading?: number;
  justification?: 'left' | 'right' | 'center' | 'full';
  allCaps?: boolean;
  smallCaps?: boolean;
  position?: [number, number] | [number, number, number];
  orientation?: [number, number, number];
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
  effects?: Array<{ effectName: string; properties?: Record<string, any> }>;
}): string {
  const fillCol = params.fillColor || params.color;
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var textLayer = comp.layers.addText(${JSON.stringify(params.text)});
    if (${JSON.stringify(params.name)}) {
      textLayer.name = ${JSON.stringify(params.name)};
    }

    if (${Boolean(params.isThreeD)}) {
      textLayer.threeDLayer = true;
    }

    var textProp = textLayer.property("ADBE Text Properties").property("ADBE Text Document");
    var textDoc = textProp.value;

    if (${params.fontSize || 0} > 0) {
      textDoc.fontSize = ${params.fontSize || 50};
    }
    if (${JSON.stringify(params.font)}) {
      textDoc.font = ${JSON.stringify(params.font)};
    }
    if (${params.applyFill !== undefined ? Boolean(params.applyFill) : 'null'} !== null) {
      textDoc.applyFill = ${Boolean(params.applyFill)};
    }
    if (${JSON.stringify(fillCol)}) {
      textDoc.applyFill = true;
      textDoc.fillColor = ${JSON.stringify(fillCol)};
    }
    if (${params.applyStroke !== undefined ? Boolean(params.applyStroke) : 'null'} !== null) {
      textDoc.applyStroke = ${Boolean(params.applyStroke)};
    }
    if (${JSON.stringify(params.strokeColor)}) {
      textDoc.applyStroke = true;
      textDoc.strokeColor = ${JSON.stringify(params.strokeColor)};
    }
    if (${params.strokeWidth !== undefined ? params.strokeWidth : 'null'} !== null) {
      textDoc.strokeWidth = ${params.strokeWidth || 1};
    }
    if (${params.strokeOverFill !== undefined ? Boolean(params.strokeOverFill) : 'null'} !== null) {
      textDoc.strokeOverFill = ${Boolean(params.strokeOverFill)};
    }
    if (${params.tracking !== undefined ? params.tracking : 'null'} !== null) {
      textDoc.tracking = ${params.tracking || 0};
    }
    if (${params.leading !== undefined ? params.leading : 'null'} !== null) {
      textDoc.leading = ${params.leading || 0};
    }
    if (${Boolean(params.allCaps)}) {
      textDoc.allCaps = true;
    }
    if (${Boolean(params.smallCaps)}) {
      textDoc.smallCaps = true;
    }

    if (${JSON.stringify(params.justification)}) {
      var jMap = {
        "left": ParagraphJustification.LEFT_JUSTIFY,
        "right": ParagraphJustification.RIGHT_JUSTIFY,
        "center": ParagraphJustification.CENTER_JUSTIFY,
        "full": ParagraphJustification.FULL_JUSTIFY_LASTLINE_FULL
      };
      var targetJ = jMap[${JSON.stringify(params.justification || 'left')}.toLowerCase()];
      if (targetJ !== undefined) textDoc.justification = targetJ;
    }

    textProp.setValue(textDoc);

    if (${JSON.stringify(params.position)}) {
      textLayer.transform.position.setValue(${JSON.stringify(params.position)});
    }
    if (${JSON.stringify(params.orientation)} && textLayer.transform.orientation) {
      textLayer.transform.orientation.setValue(${JSON.stringify(params.orientation)});
    }
    if (${params.rotationX !== undefined ? params.rotationX : 'null'} !== null && textLayer.transform.xRotation) {
      textLayer.transform.xRotation.setValue(${params.rotationX || 0});
    }
    if (${params.rotationY !== undefined ? params.rotationY : 'null'} !== null && textLayer.transform.yRotation) {
      textLayer.transform.yRotation.setValue(${params.rotationY || 0});
    }
    if (${params.rotationZ !== undefined ? params.rotationZ : 'null'} !== null && textLayer.transform.zRotation) {
      textLayer.transform.zRotation.setValue(${params.rotationZ || 0});
    }

    var addedEffects = [];
    var fxList = ${JSON.stringify(params.effects || [])};
    if (fxList && fxList.length > 0) {
      var fxParade = textLayer.property("ADBE Effect Parade");
      for (var f = 0; f < fxList.length; f++) {
        try {
          var item = fxList[f];
          var eff = fxParade.addProperty(item.effectName);
          if (item.properties) {
            for (var pKey in item.properties) {
              if (item.properties.hasOwnProperty(pKey)) {
                try { eff.property(pKey).setValue(item.properties[pKey]); } catch(pe){}
              }
            }
          }
          addedEffects.push(eff.name);
        } catch(fe){}
      }
    }

    return {
      index: textLayer.index,
      name: textLayer.name,
      text: ${JSON.stringify(params.text)},
      threeDLayer: textLayer.threeDLayer,
      font: textDoc.font,
      fontSize: textDoc.fontSize,
      position: textLayer.transform.position.value,
      effects: addedEffects
    };
  })()`;
}


export function scriptCreateSolidLayer(params: {
  compName?: string;
  name?: string;
  color: [number, number, number];
  width?: number;
  height?: number;
  duration?: number;
}): string {
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var name = ${JSON.stringify(params.name || 'Solid')};
    var color = ${JSON.stringify(params.color)};
    var w = ${params.width || 'comp.width'};
    var h = ${params.height || 'comp.height'};
    var dur = ${params.duration || 'comp.duration'};
    var solid = comp.layers.addSolid(color, name, w, h, 1.0, dur);
    return {
      index: solid.index,
      name: solid.name,
      width: w,
      height: h
    };
  })()`;
}

export function scriptGetProjectInfo(): string {
  return `(function() {
    var prj = app.project;
    var comps = [];
    var itemsCount = prj.numItems;
    for (var i = 1; i <= itemsCount; i++) {
      var item = prj.item(i);
      if (item instanceof CompItem) {
        comps.push({
          id: item.id,
          name: item.name,
          width: item.width,
          height: item.height,
          duration: item.duration,
          frameRate: item.frameRate,
          numLayers: item.numLayers
        });
      }
    }
    return {
      file: prj.file ? prj.file.fsName : null,
      dirty: prj.dirty,
      numItems: itemsCount,
      compositions: comps,
      activeItem: prj.activeItem ? prj.activeItem.name : null
    };
  })()`;
}

export function scriptSaveProject(savePath?: string): string {
  if (savePath) {
    return `(function() {
      var f = new File(${JSON.stringify(savePath)});
      app.project.save(f);
      return {
        saved: true,
        file: f.fsName
      };
    })()`;
  }
  return `(function() {
    if (app.project.file) {
      app.project.save();
      return {
        saved: true,
        file: app.project.file.fsName
      };
    } else {
      return {
        saved: false,
        message: "Project has never been saved yet. Specify a savePath or save manually once."
      };
    }
  })()`;
}

export function scriptUndo(): string {
  return `(function() {
    try {
      var undoCmd = app.findMenuCommandId("Undo");
      if (undoCmd && undoCmd !== 0) {
        app.executeCommand(undoCmd);
      } else {
        app.executeCommand(16); // 16 is standard Undo command ID in AE
      }
      return {
        success: true,
        message: "Executed Undo command in After Effects"
      };
    } catch(err) {
      return {
        success: false,
        error: err.toString()
      };
    }
  })()`;
}

export function scriptImportAsset(params: {
  filePath: string;
  compName?: string;
  sequence?: boolean;
  convertToShape?: boolean;
  isThreeD?: boolean;
  position?: [number, number] | [number, number, number];
  scale?: [number, number] | [number, number, number];
  name?: string;
}): string {
  return `(function() {
    ${ExtendScriptHelpers}
    var file = new File(${JSON.stringify(params.filePath.replace(/\\/g, '/'))});
    if (!file.exists) {
      throw new Error("File not found at: " + ${JSON.stringify(params.filePath)});
    }

    var importOptions = new ImportOptions(file);
    if (${Boolean(params.sequence)}) {
      importOptions.sequence = true;
    }

    var footage = app.project.importFile(importOptions);
    if (${JSON.stringify(params.name)}) {
      footage.name = ${JSON.stringify(params.name)};
    }

    var result = {
      footageId: footage.id,
      footageName: footage.name,
      file: footage.file ? footage.file.fsName : null,
      typeName: footage.typeName
    };

    if (${JSON.stringify(params.compName)}) {
      var comp = __findComp(${JSON.stringify(params.compName)});
      var layer = comp.layers.add(footage);
      if (${JSON.stringify(params.name)}) {
        layer.name = ${JSON.stringify(params.name)};
      }
      if (${Boolean(params.isThreeD)}) {
        layer.threeDLayer = true;
      }
      if (${JSON.stringify(params.position)}) {
        layer.transform.position.setValue(${JSON.stringify(params.position)});
      }
      if (${JSON.stringify(params.scale)}) {
        layer.transform.scale.setValue(${JSON.stringify(params.scale)});
      }

      // Convert SVG or Illustrator vector to AE Shape Layer if requested
      var shapeCreated = false;
      if (${Boolean(params.convertToShape)}) {
        try {
          comp.openInViewer();
          layer.selected = true;
          var cmdId = app.findMenuCommandId("Create Shapes from Vector Layer");
          if (!cmdId || cmdId === 0) cmdId = 3736;
          app.executeCommand(cmdId);
          shapeCreated = true;
        } catch(e) {
          // ignore if command not available
        }
      }

      result.layerIndex = layer.index;
      result.layerName = layer.name;
      result.compName = comp.name;
      result.shapeCreated = shapeCreated;
    }

    return result;
  })()`;
}

export function scriptCreate3DLayer(params: {
  compName?: string;
  layerType: 'solid' | 'text' | 'null' | 'shape';
  name?: string;
  text?: string;
  color?: [number, number, number];
  size?: [number, number];
  position?: [number, number, number];
  orientation?: [number, number, number];
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
  scale?: [number, number, number];
}): string {
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var lType = ${JSON.stringify(params.layerType)};
    var layer = null;

    if (lType === 'solid') {
      var c = ${JSON.stringify(params.color || [1, 1, 1])};
      var s = ${JSON.stringify(params.size || null)};
      var w = s ? s[0] : comp.width;
      var h = s ? s[1] : comp.height;
      layer = comp.layers.addSolid(c, ${JSON.stringify(params.name || '3D Solid')}, w, h, 1.0, comp.duration);
    } else if (lType === 'text') {
      layer = comp.layers.addText(${JSON.stringify(params.text || '3D Text')});
      if (${JSON.stringify(params.name)}) layer.name = ${JSON.stringify(params.name)};
    } else if (lType === 'null') {
      layer = comp.layers.addNull(comp.duration);
      if (${JSON.stringify(params.name)}) layer.name = ${JSON.stringify(params.name)};
    } else if (lType === 'shape') {
      layer = comp.layers.addShape();
      if (${JSON.stringify(params.name)}) layer.name = ${JSON.stringify(params.name)};
    } else {
      throw new Error("Unsupported 3D layer type: " + lType);
    }

    layer.threeDLayer = true;

    if (${JSON.stringify(params.position)}) {
      layer.transform.position.setValue(${JSON.stringify(params.position)});
    }
    if (${JSON.stringify(params.orientation)}) {
      layer.transform.orientation.setValue(${JSON.stringify(params.orientation)});
    }
    if (${params.rotationX !== undefined ? params.rotationX : 'null'} !== null) {
      layer.transform.xRotation.setValue(${params.rotationX || 0});
    }
    if (${params.rotationY !== undefined ? params.rotationY : 'null'} !== null) {
      layer.transform.yRotation.setValue(${params.rotationY || 0});
    }
    if (${params.rotationZ !== undefined ? params.rotationZ : 'null'} !== null) {
      layer.transform.zRotation.setValue(${params.rotationZ || 0});
    }
    if (${JSON.stringify(params.scale)}) {
      layer.transform.scale.setValue(${JSON.stringify(params.scale)});
    }

    return {
      index: layer.index,
      name: layer.name,
      threeDLayer: layer.threeDLayer,
      type: lType,
      position: layer.transform.position.value,
      orientation: layer.transform.orientation.value
    };
  })()`;
}

export function scriptCreateLight(params: {
  compName?: string;
  name?: string;
  lightType?: 'POINT' | 'SPOT' | 'PARALLEL' | 'AMBIENT';
  intensity?: number;
  color?: [number, number, number];
  coneAngle?: number;
  coneFeather?: number;
  castsShadows?: boolean;
  shadowDarkness?: number;
  shadowDiffusion?: number;
  position?: [number, number, number];
  pointOfInterest?: [number, number, number];
}): string {
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var name = ${JSON.stringify(params.name || 'Light 1')};
    var center = [comp.width / 2, comp.height / 2];
    var light = comp.layers.addLight(name, center);

    var typeMap = {
      "PARALLEL": LightType.PARALLEL,
      "SPOT": LightType.SPOT,
      "POINT": LightType.POINT,
      "AMBIENT": LightType.AMBIENT
    };
    var tKey = ${JSON.stringify(params.lightType || 'POINT')}.toUpperCase();
    if (typeMap[tKey]) {
      light.lightType = typeMap[tKey];
    }

    if (${params.intensity !== undefined ? params.intensity : 'null'} !== null) {
      light.lightOption.intensity.setValue(${params.intensity || 100});
    }
    if (${JSON.stringify(params.color)}) {
      light.lightOption.color.setValue(${JSON.stringify(params.color)});
    }
    if (${params.coneAngle !== undefined ? params.coneAngle : 'null'} !== null && light.lightOption.coneAngle) {
      light.lightOption.coneAngle.setValue(${params.coneAngle || 90});
    }
    if (${params.coneFeather !== undefined ? params.coneFeather : 'null'} !== null && light.lightOption.coneFeather) {
      light.lightOption.coneFeather.setValue(${params.coneFeather || 50});
    }
    if (${params.castsShadows !== undefined ? Boolean(params.castsShadows) : 'null'} !== null && light.lightOption.castsShadows) {
      light.lightOption.castsShadows.setValue(${Boolean(params.castsShadows)});
    }
    if (${params.shadowDarkness !== undefined ? params.shadowDarkness : 'null'} !== null && light.lightOption.shadowDarkness) {
      light.lightOption.shadowDarkness.setValue(${params.shadowDarkness || 100});
    }
    if (${params.shadowDiffusion !== undefined ? params.shadowDiffusion : 'null'} !== null && light.lightOption.shadowDiffusion) {
      light.lightOption.shadowDiffusion.setValue(${params.shadowDiffusion || 0});
    }
    if (${JSON.stringify(params.position)}) {
      light.transform.position.setValue(${JSON.stringify(params.position)});
    }
    if (${JSON.stringify(params.pointOfInterest)} && light.transform.pointOfInterest) {
      light.transform.pointOfInterest.setValue(${JSON.stringify(params.pointOfInterest)});
    }

    return {
      index: light.index,
      name: light.name,
      lightType: tKey,
      intensity: light.lightOption.intensity.value,
      position: light.transform.position.value
    };
  })()`;
}

export function scriptSet3DLayerTransform(params: {
  compName?: string;
  layerName?: string;
  layerIndex?: number;
  position?: [number, number, number];
  orientation?: [number, number, number];
  xRotation?: number;
  yRotation?: number;
  zRotation?: number;
  scale?: [number, number, number];
  anchorPoint?: [number, number, number];
}): string {
  const layerRef = params.layerIndex !== undefined ? params.layerIndex : (params.layerName || 1);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var layer = __findLayer(comp, ${JSON.stringify(layerRef)});
    layer.threeDLayer = true;

    if (${JSON.stringify(params.position)}) {
      layer.transform.position.setValue(${JSON.stringify(params.position)});
    }
    if (${JSON.stringify(params.orientation)}) {
      layer.transform.orientation.setValue(${JSON.stringify(params.orientation)});
    }
    if (${params.xRotation !== undefined ? params.xRotation : 'null'} !== null && layer.transform.xRotation) {
      layer.transform.xRotation.setValue(${params.xRotation || 0});
    }
    if (${params.yRotation !== undefined ? params.yRotation : 'null'} !== null && layer.transform.yRotation) {
      layer.transform.yRotation.setValue(${params.yRotation || 0});
    }
    if (${params.zRotation !== undefined ? params.zRotation : 'null'} !== null && layer.transform.zRotation) {
      layer.transform.zRotation.setValue(${params.zRotation || 0});
    }
    if (${JSON.stringify(params.scale)}) {
      layer.transform.scale.setValue(${JSON.stringify(params.scale)});
    }
    if (${JSON.stringify(params.anchorPoint)}) {
      layer.transform.anchorPoint.setValue(${JSON.stringify(params.anchorPoint)});
    }

    return {
      layerIndex: layer.index,
      layerName: layer.name,
      position: layer.transform.position.value,
      scale: layer.transform.scale.value,
      orientation: layer.transform.orientation ? layer.transform.orientation.value : null
    };
  })()`;
}

export function scriptAddLayerMask(params: {
  compName?: string;
  layerName?: string;
  layerIndex?: number;
  maskName?: string;
  shapeType: 'rectangle' | 'ellipse' | 'polygon' | 'custom';
  bounds?: [number, number, number, number]; // [left, top, width, height]
  vertices?: [number, number][];
  inTangents?: [number, number][];
  outTangents?: [number, number][];
  closed?: boolean;
  maskMode?: 'add' | 'subtract' | 'intersect' | 'lighten' | 'darken' | 'difference' | 'none';
  feather?: [number, number];
  opacity?: number;
  expansion?: number;
  inverted?: boolean;
}): string {
  const layerRef = params.layerIndex !== undefined ? params.layerIndex : (params.layerName || 1);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var layer = __findLayer(comp, ${JSON.stringify(layerRef)});
    var masks = layer.property("ADBE Mask Parade");
    if (!masks) throw new Error("Layer does not support masks.");

    var mask = masks.addProperty("ADBE Mask Atom");
    if (${JSON.stringify(params.maskName)}) {
      mask.name = ${JSON.stringify(params.maskName)};
    }

    var shape = new Shape();
    var shapeType = ${JSON.stringify(params.shapeType)};
    var bounds = ${JSON.stringify(params.bounds || null)};

    if (shapeType === 'rectangle') {
      var x = bounds ? bounds[0] : 0;
      var y = bounds ? bounds[1] : 0;
      var w = bounds ? bounds[2] : (layer.width || comp.width);
      var h = bounds ? bounds[3] : (layer.height || comp.height);
      shape.vertices = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      shape.closed = true;
    } else if (shapeType === 'ellipse') {
      var x = bounds ? bounds[0] : 0;
      var y = bounds ? bounds[1] : 0;
      var w = bounds ? bounds[2] : (layer.width || comp.width);
      var h = bounds ? bounds[3] : (layer.height || comp.height);
      var cx = x + w / 2;
      var cy = y + h / 2;
      var rx = w / 2;
      var ry = h / 2;
      var k = 0.5522847498;
      shape.vertices = [[cx, y], [x + w, cy], [cx, y + h], [x, cy]];
      shape.inTangents = [[-rx * k, 0], [0, -ry * k], [rx * k, 0], [0, ry * k]];
      shape.outTangents = [[rx * k, 0], [0, ry * k], [-rx * k, 0], [0, -ry * k]];
      shape.closed = true;
    } else if (shapeType === 'polygon' || shapeType === 'custom') {
      var verts = ${JSON.stringify(params.vertices || [])};
      shape.vertices = verts;
      if (${JSON.stringify(params.inTangents)}) shape.inTangents = ${JSON.stringify(params.inTangents)};
      if (${JSON.stringify(params.outTangents)}) shape.outTangents = ${JSON.stringify(params.outTangents)};
      shape.closed = ${params.closed !== undefined ? Boolean(params.closed) : 'true'};
    }

    mask.property("ADBE Mask Shape").setValue(shape);

    if (${JSON.stringify(params.maskMode)}) {
      var modeMap = {
        "none": MaskMode.NONE,
        "add": MaskMode.ADD,
        "subtract": MaskMode.SUBTRACT,
        "intersect": MaskMode.INTERSECT,
        "lighten": MaskMode.LIGHTEN,
        "darken": MaskMode.DARKEN,
        "difference": MaskMode.DIFFERENCE
      };
      var targetMode = modeMap[${JSON.stringify(params.maskMode || 'add')}.toLowerCase()];
      if (targetMode !== undefined) mask.maskMode = targetMode;
    }

    if (${params.inverted !== undefined ? params.inverted : 'null'} !== null) {
      mask.inverted = ${Boolean(params.inverted)};
    }
    if (${params.opacity !== undefined ? params.opacity : 'null'} !== null) {
      mask.property("ADBE Mask Opacity").setValue(${params.opacity || 100});
    }
    if (${JSON.stringify(params.feather)}) {
      mask.property("ADBE Mask Feather").setValue(${JSON.stringify(params.feather)});
    }
    if (${params.expansion !== undefined ? params.expansion : 'null'} !== null) {
      mask.property("ADBE Mask Offset").setValue(${params.expansion || 0});
    }

    return {
      layerName: layer.name,
      maskIndex: mask.propertyIndex,
      maskName: mask.name,
      shapeType: shapeType,
      maskMode: ${JSON.stringify(params.maskMode || 'add')},
      inverted: mask.inverted
    };
  })()`;
}

export function scriptGetLayerMaterialOptions(params: {
  compName?: string;
  layerName?: string;
  layerIndex?: number;
}): string {
  const layerRef = params.layerIndex !== undefined ? params.layerIndex : (params.layerName || 1);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var layer = __findLayer(comp, ${JSON.stringify(layerRef)});
    if (!layer.threeDLayer) {
      return {
        layerName: layer.name,
        threeDLayer: false,
        message: "Layer is not a 3D layer. Enable 3D to access material options."
      };
    }

    var mat = layer.property("ADBE Material Options Group");
    if (!mat) {
      return {
        layerName: layer.name,
        threeDLayer: true,
        materialOptions: null,
        message: "Layer does not support material options group."
      };
    }

    var props = [];
    for (var i = 1; i <= mat.numProperties; i++) {
      var p = mat.property(i);
      var val = null;
      try { val = p.value; } catch(e){}
      props.push({
        index: p.propertyIndex,
        name: p.name,
        matchName: p.matchName,
        value: val,
        canVaryOverTime: p.canVaryOverTime
      });
    }

    return {
      layerName: layer.name,
      layerIndex: layer.index,
      threeDLayer: true,
      materialOptionsCount: props.length,
      properties: props
    };
  })()`;
}

export function scriptSetLayerMaterialOptions(params: {
  compName?: string;
  layerName?: string;
  layerIndex?: number;
  castsShadows?: 'off' | 'on' | 'only' | number;
  lightTransmission?: number;
  acceptsShadows?: 'off' | 'on' | 'only' | number;
  acceptsLights?: 'off' | 'on' | number;
  appearsInReflections?: 'off' | 'on' | 'only' | number;
  ambient?: number;
  diffuse?: number;
  specularIntensity?: number;
  specularShininess?: number;
  metal?: number;
  roughness?: number;
  reflectionCoefficient?: number;
  transparency?: number;
  customProperties?: Record<string, any>;
}): string {
  const layerRef = params.layerIndex !== undefined ? params.layerIndex : (params.layerName || 1);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var layer = __findLayer(comp, ${JSON.stringify(layerRef)});
    layer.threeDLayer = true;

    var mat = layer.property("ADBE Material Options Group");
    if (!mat) throw new Error("Layer does not have Material Options group.");

    function setTriState(prop, val) {
      if (!prop) return;
      if (typeof val === "number") { prop.setValue(val); return; }
      if (typeof val === "string") {
        var low = val.toLowerCase();
        if (low === "off") prop.setValue(1);
        else if (low === "on") prop.setValue(2);
        else if (low === "only") prop.setValue(3);
      }
    }

    function setBinaryState(prop, val) {
      if (!prop) return;
      if (typeof val === "number") { prop.setValue(val); return; }
      if (typeof val === "string") {
        prop.setValue(val.toLowerCase() === "on" ? 2 : 1);
      } else if (typeof val === "boolean") {
        prop.setValue(val ? 2 : 1);
      }
    }

    var updated = [];

    if (${JSON.stringify(params.castsShadows)} !== null) {
      var p = mat.property("ADBE Casts Shadows");
      setTriState(p, ${JSON.stringify(params.castsShadows)});
      if (p) updated.push({ name: p.name, value: p.value });
    }
    if (${params.lightTransmission !== undefined ? params.lightTransmission : 'null'} !== null) {
      var p = mat.property("ADBE Light Transmission");
      if (p) { p.setValue(${params.lightTransmission || 0}); updated.push({ name: p.name, value: p.value }); }
    }
    if (${JSON.stringify(params.acceptsShadows)} !== null) {
      var p = mat.property("ADBE Accepts Shadows");
      setTriState(p, ${JSON.stringify(params.acceptsShadows)});
      if (p) updated.push({ name: p.name, value: p.value });
    }
    if (${JSON.stringify(params.acceptsLights)} !== null) {
      var p = mat.property("ADBE Accepts Lights");
      setBinaryState(p, ${JSON.stringify(params.acceptsLights)});
      if (p) updated.push({ name: p.name, value: p.value });
    }
    if (${params.ambient !== undefined ? params.ambient : 'null'} !== null) {
      var p = mat.property("ADBE Ambient");
      if (p) { p.setValue(${params.ambient || 0}); updated.push({ name: p.name, value: p.value }); }
    }
    if (${params.diffuse !== undefined ? params.diffuse : 'null'} !== null) {
      var p = mat.property("ADBE Diffuse");
      if (p) { p.setValue(${params.diffuse || 0}); updated.push({ name: p.name, value: p.value }); }
    }
    if (${params.specularIntensity !== undefined ? params.specularIntensity : 'null'} !== null) {
      var p = mat.property("ADBE Specular Intensity");
      if (p) { p.setValue(${params.specularIntensity || 0}); updated.push({ name: p.name, value: p.value }); }
    }
    if (${params.specularShininess !== undefined ? params.specularShininess : 'null'} !== null) {
      var p = mat.property("ADBE Shininess");
      if (p) { p.setValue(${params.specularShininess || 0}); updated.push({ name: p.name, value: p.value }); }
    }
    if (${params.metal !== undefined ? params.metal : 'null'} !== null) {
      var p = mat.property("ADBE Metal");
      if (p) { p.setValue(${params.metal || 0}); updated.push({ name: p.name, value: p.value }); }
    }

    var custom = ${JSON.stringify(params.customProperties || {})};
    for (var k in custom) {
      if (custom.hasOwnProperty(k)) {
        try {
          var cp = mat.property(k);
          if (cp && cp.setValue) {
            cp.setValue(custom[k]);
            updated.push({ name: cp.name, value: cp.value });
          }
        } catch(e){}
      }
    }

    return {
      layerName: layer.name,
      updatedCount: updated.length,
      updatedProperties: updated
    };
  })()`;
}

export function scriptGetCompRenderer(params: { compName?: string }): string {
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    return {
      compName: comp.name,
      currentRenderer: comp.renderer,
      availableRenderers: comp.renderers
    };
  })()`;
}

export function scriptSetCompRenderer(params: {
  compName?: string;
  renderer: string;
}): string {
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var target = ${JSON.stringify(params.renderer)};
    comp.renderer = target;
    return {
      compName: comp.name,
      renderer: comp.renderer,
      availableRenderers: comp.renderers
    };
  })()`;
}

export function scriptSetKeyframeVelocity(params: {
  compName?: string;
  layerName?: string;
  layerIndex?: number;
  propertyName: string;
  keyIndex?: number;
  time?: number;
  inSpeed?: number;
  inInfluence?: number;
  outSpeed?: number;
  outInfluence?: number;
  preset?: 'easyEase' | 'easeIn' | 'easeOut' | 'dynamicSnap' | 'extremeSnap' | 'linear';
}): string {
  const layerRef = params.layerIndex !== undefined ? params.layerIndex : (params.layerName || 1);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var layer = __findLayer(comp, ${JSON.stringify(layerRef)});
    var prop = __findProp(layer, ${JSON.stringify(params.propertyName)});
    if (!prop.canVaryOverTime || prop.numKeys === 0) {
      throw new Error("Property " + ${JSON.stringify(params.propertyName)} + " has no keyframes to adjust velocity.");
    }

    var kIndex = 1;
    if (${params.keyIndex !== undefined ? params.keyIndex : 'null'} !== null) {
      kIndex = ${params.keyIndex || 1};
      if (kIndex < 1 || kIndex > prop.numKeys) {
        throw new Error("Keyframe index " + kIndex + " out of bounds (1-" + prop.numKeys + ").");
      }
    } else if (${params.time !== undefined ? params.time : 'null'} !== null) {
      kIndex = prop.nearestKeyIndex(${params.time || 0});
    }

    var preset = ${JSON.stringify(params.preset || null)};
    var inSpd = ${params.inSpeed !== undefined ? params.inSpeed : 0};
    var inInf = ${params.inInfluence !== undefined ? params.inInfluence : 33.33};
    var outSpd = ${params.outSpeed !== undefined ? params.outSpeed : 0};
    var outInf = ${params.outInfluence !== undefined ? params.outInfluence : 33.33};

    if (preset === 'easyEase') {
      inSpd = 0; inInf = 33.33; outSpd = 0; outInf = 33.33;
    } else if (preset === 'easeIn') {
      inSpd = 0; inInf = 33.33; outSpd = 0; outInf = 0.1;
    } else if (preset === 'easeOut') {
      inSpd = 0; inInf = 0.1; outSpd = 0; outInf = 33.33;
    } else if (preset === 'dynamicSnap') {
      inSpd = 0; inInf = 75; outSpd = 0; outInf = 75;
    } else if (preset === 'extremeSnap') {
      inSpd = 0; inInf = 92; outSpd = 0; outInf = 92;
    } else if (preset === 'linear') {
      prop.setInterpolationTypeAtKey(kIndex, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
      return {
        keyIndex: kIndex,
        time: prop.keyTime(kIndex),
        type: "linear"
      };
    }

    // Clamp influence between 0.1 and 100
    if (inInf < 0.1) inInf = 0.1; if (inInf > 100) inInf = 100;
    if (outInf < 0.1) outInf = 0.1; if (outInf > 100) outInf = 100;

    var inEaseObj = new KeyframeEase(inSpd, inInf);
    var outEaseObj = new KeyframeEase(outSpd, outInf);

    prop.setInterpolationTypeAtKey(kIndex, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
    __setKeyTemporalEase(prop, kIndex, inEaseObj, outEaseObj);

    return {
      propertyName: prop.name,
      keyIndex: kIndex,
      time: prop.keyTime(kIndex),
      value: prop.keyValue(kIndex),
      inSpeed: inSpd,
      inInfluence: inInf,
      outSpeed: outSpd,
      outInfluence: outInf,
      presetApplied: preset
    };
  })()`;
}

export function scriptGetKeyframeInfo(params: {
  compName?: string;
  layerName?: string;
  layerIndex?: number;
  propertyName: string;
}): string {
  const layerRef = params.layerIndex !== undefined ? params.layerIndex : (params.layerName || 1);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var layer = __findLayer(comp, ${JSON.stringify(layerRef)});
    var prop = __findProp(layer, ${JSON.stringify(params.propertyName)});

    if (!prop.canVaryOverTime) {
      return {
        propertyName: prop.name,
        canVaryOverTime: false,
        numKeys: 0,
        currentValue: prop.value
      };
    }

    var keys = [];
    for (var k = 1; k <= prop.numKeys; k++) {
      var inEase = null;
      var outEase = null;
      try {
        var ie = prop.keyInTemporalEase(k);
        if (ie && ie.length > 0) inEase = { speed: ie[0].speed, influence: ie[0].influence };
      } catch(e){}
      try {
        var oe = prop.keyOutTemporalEase(k);
        if (oe && oe.length > 0) outEase = { speed: oe[0].speed, influence: oe[0].influence };
      } catch(e){}

      keys.push({
        index: k,
        time: prop.keyTime(k),
        value: prop.keyValue(k),
        inEase: inEase,
        outEase: outEase
      });
    }

    return {
      propertyName: prop.name,
      canVaryOverTime: true,
      numKeys: prop.numKeys,
      keyframes: keys
    };
  })()`;
}

export function scriptExportFrame(params: {
  compName?: string;
  time?: number;
  frame?: number;
  outputPath: string;
}): string {
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var targetTime = 0;
    if (${params.time !== undefined ? params.time : 'null'} !== null) {
      targetTime = ${params.time || 0};
    } else if (${params.frame !== undefined ? params.frame : 'null'} !== null) {
      targetTime = (${params.frame || 0}) / comp.frameRate;
    } else {
      targetTime = comp.time;
    }

    var outFile = new File(${JSON.stringify(params.outputPath.replace(/\\/g, '/'))});
    var outFolder = outFile.parent;
    if (!outFolder.exists) outFolder.create();

    if (comp.saveFrameToPng) {
      comp.saveFrameToPng(targetTime, outFile);
      return {
        success: true,
        method: "saveFrameToPng",
        filePath: outFile.fsName,
        time: targetTime,
        frame: Math.round(targetTime * comp.frameRate),
        width: comp.width,
        height: comp.height
      };
    }

    throw new Error("comp.saveFrameToPng not available in this AE version.");
  })()`;
}

export function scriptExportPreviewVideo(params: {
  compName?: string;
  startFrame?: number;
  endFrame?: number;
  startTime?: number;
  endTime?: number;
  quality?: 'low' | 'draft' | 'medium' | 'high';
  resolution?: 'quarter' | 'half' | 'full';
  outputPath: string;
}): string {
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var fps = comp.frameRate;

    var sTime = 0;
    var eTime = comp.duration;

    if (${params.startTime !== undefined ? params.startTime : 'null'} !== null) {
      sTime = ${params.startTime || 0};
    } else if (${params.startFrame !== undefined ? params.startFrame : 'null'} !== null) {
      sTime = (${params.startFrame || 0}) / fps;
    }

    if (${params.endTime !== undefined ? params.endTime : 'null'} !== null) {
      eTime = ${params.endTime || 0};
    } else if (${params.endFrame !== undefined ? params.endFrame : 'null'} !== null) {
      eTime = (${params.endFrame || 0}) / fps;
    }

    var dur = eTime - sTime;
    if (dur <= 0) dur = 1 / fps;

    // Set composition work area
    var originalWorkStart = comp.workAreaStart;
    var originalWorkDuration = comp.workAreaDuration;

    comp.workAreaStart = sTime;
    comp.workAreaDuration = dur;

    var outFile = new File(${JSON.stringify(params.outputPath.replace(/\\/g, '/'))});
    if (!outFile.parent.exists) outFile.parent.create();

    // Add to render queue
    var rqItem = app.project.renderQueue.items.add(comp);
    rqItem.timeSpanStart = sTime;
    rqItem.timeSpanDuration = dur;

    var resKey = ${JSON.stringify(params.resolution || 'quarter')};
    try {
      if (resKey === 'quarter') {
        rqItem.setSetting("Resolution", "Quarter");
      } else if (resKey === 'half') {
        rqItem.setSetting("Resolution", "Half");
      } else {
        rqItem.setSetting("Resolution", "Full");
      }
    } catch(re) {}

    var om = rqItem.outputModule(1);
    om.file = outFile;

    // Render
    app.project.renderQueue.render();

    // Restore work area
    comp.workAreaStart = originalWorkStart;
    comp.workAreaDuration = originalWorkDuration;

    return {
      success: true,
      filePath: outFile.fsName,
      startTime: sTime,
      endTime: eTime,
      duration: dur,
      startFrame: Math.round(sTime * fps),
      endFrame: Math.round(eTime * fps),
      resolution: resKey,
      fileSize: outFile.exists ? outFile.length : 0
    };
  })()`;
}

export function scriptExportWithAME(params: {
  compName?: string;
  outputPath?: string;
  presetPath?: string;
  renderImmediately?: boolean;
}): string {
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});

    // Add to AE render queue first
    var rqItem = app.project.renderQueue.items.add(comp);
    
    if (${JSON.stringify(params.outputPath || null)} !== null) {
      var outFile = new File(${JSON.stringify(params.outputPath ? params.outputPath.replace(/\\/g, '/') : '')});
      if (!outFile.parent.exists) outFile.parent.create();
      try {
        rqItem.outputModule(1).file = outFile;
      } catch(e){}
    }

    var ameAvailable = false;
    var queueResult = "queued_in_render_queue";

    // Queue in AME method
    if (app.project.renderQueue.queueInAME) {
      try {
        var renderImmediately = ${Boolean(params.renderImmediately)};
        app.project.renderQueue.queueInAME(renderImmediately);
        ameAvailable = true;
        queueResult = "queued_in_adobe_media_encoder";
      } catch(ameErr) {
        queueResult = "queueInAME_failed: " + ameErr.toString();
      }
    }

    return {
      success: true,
      compName: comp.name,
      ameAvailable: ameAvailable,
      status: queueResult,
      renderImmediately: Boolean(${params.renderImmediately}),
      outputPath: ${JSON.stringify(params.outputPath || null)}
    };
  })()`;
}

export function scriptSetEffectPropertyKeyframe(params: {
  compName?: string;
  layerName?: string;
  layerIndex?: number;
  effectName?: string;
  effectIndex?: number;
  propertyName: string;
  time: number;
  value: any;
  keyframeInterpolation?: 'linear' | 'ease' | 'easeIn' | 'easeOut' | 'hold';
}): string {
  const layerRef = params.layerIndex !== undefined ? params.layerIndex : (params.layerName || 1);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var layer = __findLayer(comp, ${JSON.stringify(layerRef)});
    var effects = layer.property("ADBE Effect Parade");
    if (!effects) throw new Error("Layer has no effects parade.");

    var eff = null;
    if (${params.effectIndex !== undefined ? params.effectIndex : 'null'} !== null) {
      eff = effects.property(${params.effectIndex || 1});
    } else if (${JSON.stringify(params.effectName)}) {
      var effTarget = ${JSON.stringify(params.effectName)};
      for (var i = 1; i <= effects.numProperties; i++) {
        var candidate = effects.property(i);
        if (candidate.name === effTarget || candidate.matchName === effTarget) {
          eff = candidate;
          break;
        }
      }
    }

    if (!eff) throw new Error("Effect not found.");

    var pName = ${JSON.stringify(params.propertyName)};
    var prop = eff.property(pName);
    if (!prop) {
      for (var j = 1; j <= eff.numProperties; j++) {
        if (eff.property(j).name === pName || eff.property(j).matchName === pName) {
          prop = eff.property(j);
          break;
        }
      }
    }

    if (!prop) throw new Error("Effect property '" + pName + "' not found.");
    if (!prop.canVaryOverTime) throw new Error("Property '" + pName + "' cannot be animated.");

    var time = ${params.time};
    var val = ${JSON.stringify(params.value)};
    prop.setValueAtTime(time, val);
    var keyIndex = prop.nearestKeyIndex(time);

    var interp = ${JSON.stringify(params.keyframeInterpolation || 'ease')};
    if (interp === 'hold') {
      prop.setInterpolationTypeAtKey(keyIndex, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
    } else if (interp === 'ease' || interp === 'easeIn' || interp === 'easeOut') {
      var easeInObj = new KeyframeEase(0, 33.33);
      var easeOutObj = new KeyframeEase(0, 33.33);
      __setKeyTemporalEase(prop, keyIndex, easeInObj, easeOutObj);
    } else {
      prop.setInterpolationTypeAtKey(keyIndex, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
    }

    return {
      effectName: eff.name,
      propertyName: prop.name,
      keyIndex: keyIndex,
      time: time,
      value: val,
      interpolation: interp
    };
  })()`;
}

export function scriptSetEffectEnabled(params: {
  compName?: string;
  layerName?: string;
  layerIndex?: number;
  effectName?: string;
  effectIndex?: number;
  enabled: boolean;
}): string {
  const layerRef = params.layerIndex !== undefined ? params.layerIndex : (params.layerName || 1);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var layer = __findLayer(comp, ${JSON.stringify(layerRef)});
    var effects = layer.property("ADBE Effect Parade");
    if (!effects) throw new Error("No effects on layer.");

    var eff = null;
    if (${params.effectIndex !== undefined ? params.effectIndex : 'null'} !== null) {
      eff = effects.property(${params.effectIndex || 1});
    } else if (${JSON.stringify(params.effectName)}) {
      var effTarget = ${JSON.stringify(params.effectName)};
      for (var i = 1; i <= effects.numProperties; i++) {
        var candidate = effects.property(i);
        if (candidate.name === effTarget || candidate.matchName === effTarget) {
          eff = candidate;
          break;
        }
      }
    }

    if (!eff) throw new Error("Effect not found.");
    eff.enabled = ${Boolean(params.enabled)};

    return {
      layerName: layer.name,
      effectName: eff.name,
      enabled: eff.enabled
    };
  })()`;
}

export function scriptReorderEffect(params: {
  compName?: string;
  layerName?: string;
  layerIndex?: number;
  effectName?: string;
  effectIndex?: number;
  newIndex: number;
}): string {
  const layerRef = params.layerIndex !== undefined ? params.layerIndex : (params.layerName || 1);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var layer = __findLayer(comp, ${JSON.stringify(layerRef)});
    var effects = layer.property("ADBE Effect Parade");
    if (!effects) throw new Error("No effects on layer.");

    var eff = null;
    if (${params.effectIndex !== undefined ? params.effectIndex : 'null'} !== null) {
      eff = effects.property(${params.effectIndex || 1});
    } else if (${JSON.stringify(params.effectName)}) {
      var effTarget = ${JSON.stringify(params.effectName)};
      for (var i = 1; i <= effects.numProperties; i++) {
        var candidate = effects.property(i);
        if (candidate.name === effTarget || candidate.matchName === effTarget) {
          eff = candidate;
          break;
        }
      }
    }

    if (!eff) throw new Error("Effect not found.");
    eff.moveTo(${params.newIndex});

    return {
      layerName: layer.name,
      effectName: eff.name,
      newIndex: eff.propertyIndex
    };
  })()`;
}

export function scriptFormatTextLayer(params: {
  compName?: string;
  layerName?: string;
  layerIndex?: number;
  text?: string;
  fontSize?: number;
  font?: string;
  fillColor?: [number, number, number];
  applyFill?: boolean;
  strokeColor?: [number, number, number];
  strokeWidth?: number;
  applyStroke?: boolean;
  strokeOverFill?: boolean;
  tracking?: number;
  leading?: number;
  justification?: 'left' | 'right' | 'center' | 'full';
  allCaps?: boolean;
  smallCaps?: boolean;
}): string {
  const layerRef = params.layerIndex !== undefined ? params.layerIndex : (params.layerName || 1);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var layer = __findLayer(comp, ${JSON.stringify(layerRef)});
    var textProp = layer.property("ADBE Text Properties").property("ADBE Text Document");
    var textDoc = textProp.value;

    if (${JSON.stringify(params.text)} !== null && ${JSON.stringify(params.text)} !== undefined) {
      textDoc.text = ${JSON.stringify(params.text)};
    }
    if (${params.fontSize || 0} > 0) {
      textDoc.fontSize = ${params.fontSize || 50};
    }
    if (${JSON.stringify(params.font)}) {
      textDoc.font = ${JSON.stringify(params.font)};
    }
    if (${params.applyFill !== undefined ? Boolean(params.applyFill) : 'null'} !== null) {
      textDoc.applyFill = ${Boolean(params.applyFill)};
    }
    if (${JSON.stringify(params.fillColor)}) {
      textDoc.applyFill = true;
      textDoc.fillColor = ${JSON.stringify(params.fillColor)};
    }
    if (${params.applyStroke !== undefined ? Boolean(params.applyStroke) : 'null'} !== null) {
      textDoc.applyStroke = ${Boolean(params.applyStroke)};
    }
    if (${JSON.stringify(params.strokeColor)}) {
      textDoc.applyStroke = true;
      textDoc.strokeColor = ${JSON.stringify(params.strokeColor)};
    }
    if (${params.strokeWidth !== undefined ? params.strokeWidth : 'null'} !== null) {
      textDoc.strokeWidth = ${params.strokeWidth || 1};
    }
    if (${params.strokeOverFill !== undefined ? Boolean(params.strokeOverFill) : 'null'} !== null) {
      textDoc.strokeOverFill = ${Boolean(params.strokeOverFill)};
    }
    if (${params.tracking !== undefined ? params.tracking : 'null'} !== null) {
      textDoc.tracking = ${params.tracking || 0};
    }
    if (${params.leading !== undefined ? params.leading : 'null'} !== null) {
      textDoc.leading = ${params.leading || 0};
    }
    if (${params.allCaps !== undefined ? Boolean(params.allCaps) : 'null'} !== null) {
      textDoc.allCaps = ${Boolean(params.allCaps)};
    }
    if (${params.smallCaps !== undefined ? Boolean(params.smallCaps) : 'null'} !== null) {
      textDoc.smallCaps = ${Boolean(params.smallCaps)};
    }

    if (${JSON.stringify(params.justification)}) {
      var jMap = {
        "left": ParagraphJustification.LEFT_JUSTIFY,
        "right": ParagraphJustification.RIGHT_JUSTIFY,
        "center": ParagraphJustification.CENTER_JUSTIFY,
        "full": ParagraphJustification.FULL_JUSTIFY_LASTLINE_FULL
      };
      var targetJ = jMap[${JSON.stringify(params.justification || 'left')}.toLowerCase()];
      if (targetJ !== undefined) textDoc.justification = targetJ;
    }

    textProp.setValue(textDoc);

    return {
      layerName: layer.name,
      text: textDoc.text,
      font: textDoc.font,
      fontSize: textDoc.fontSize,
      fillColor: textDoc.fillColor,
      tracking: textDoc.tracking
    };
  })()`;
}

export function scriptGetAvailableFonts(): string {
  return `(function() {
    var fonts = [];
    if (typeof app.fonts !== "undefined" && app.fonts.allFonts) {
      for (var i = 0; i < app.fonts.allFonts.length; i++) {
        var f = app.fonts.allFonts[i];
        fonts.push({
          postScriptName: f.postScriptName,
          family: f.family,
          style: f.style
        });
      }
    } else {
      var common = [
        "ArialMT", "Arial-BoldMT", "Arial-ItalicMT",
        "Helvetica", "Helvetica-Bold",
        "TimesNewRomanPSMT", "TimesNewRomanPS-BoldMT",
        "MicrosoftYaHei", "MicrosoftYaHei-Bold", "SimHei", "SimSun", "KaiTi",
        "PingFangSC-Regular", "PingFangSC-Medium", "PingFangSC-Semibold",
        "SourceHanSansCN-Regular", "SourceHanSansCN-Bold",
        "SegoeUI", "SegoeUI-Bold", "Roboto-Regular", "Roboto-Bold",
        "Impact", "Futura-Medium", "Futura-Bold", "Georgia"
      ];
      for (var j = 0; j < common.length; j++) {
        fonts.push({ postScriptName: common[j] });
      }
    }
    return {
      count: fonts.length,
      fonts: fonts
    };
  })()`;
}

export function scriptAddTextAnimator(params: {
  compName?: string;
  layerName?: string;
  layerIndex?: number;
  animatorName?: string;
  preset?: 'typewriter' | 'fade_up_chars' | 'slide_in_chars' | 'scale_pop_chars' | 'tracking_expand' | '3d_flip_chars' | 'wiggle_wave' | 'glitch_decoder' | 'custom';
  startTime?: number;
  duration?: number;
  properties?: {
    position?: [number, number] | [number, number, number];
    scale?: [number, number] | [number, number, number];
    rotation?: number;
    rotationX?: number;
    rotationY?: number;
    rotationZ?: number;
    opacity?: number;
    tracking?: number;
    blur?: [number, number];
    fillColor?: [number, number, number];
    strokeColor?: [number, number, number];
    strokeWidth?: number;
    skew?: number;
    characterOffset?: number;
  };
  rangeSelector?: {
    start?: number;
    end?: number;
    offset?: number;
    basedOn?: 'characters' | 'words' | 'lines';
    shape?: 'square' | 'ramp_up' | 'ramp_down' | 'triangle' | 'round' | 'smooth';
    easeHigh?: number;
    easeLow?: number;
    randomizeOrder?: boolean;
    animateOverTime?: {
      startTime: number;
      endTime: number;
      type: 'start' | 'end' | 'offset';
    };
  };
  wigglySelector?: {
    wigglesPerSecond?: number;
    correlation?: number;
  };
}): string {
  const layerRef = params.layerIndex !== undefined ? params.layerIndex : (params.layerName || 1);
  return `(function() {
    ${ExtendScriptHelpers}
    var comp = __findComp(${JSON.stringify(params.compName)});
    var layer = __findLayer(comp, ${JSON.stringify(layerRef)});
    var textProps = layer.property("ADBE Text Properties");
    if (!textProps) throw new Error("Layer is not a text layer.");

    var animators = textProps.property("ADBE Text Animators");
    var animator = animators.addProperty("ADBE Text Animator");
    animator.name = ${JSON.stringify(params.animatorName || 'Animator 1')};

    var animProps = animator.property("ADBE Text Animator Properties");
    var selectors = animator.property("ADBE Text Selectors");

    var preset = ${JSON.stringify(params.preset || 'custom')};
    var sTime = ${params.startTime !== undefined ? params.startTime : 0};
    var dur = ${params.duration !== undefined ? params.duration : 1.5};
    var eTime = sTime + dur;

    if (preset === 'typewriter') {
      animProps.addProperty("ADBE Text Opacity").setValue(0);
      var sel = selectors.addProperty("ADBE Text Selector");
      var startProp = sel.property("ADBE Text Percent Start");
      startProp.setValueAtTime(sTime, 0);
      startProp.setValueAtTime(eTime, 100);
    } else if (preset === 'fade_up_chars') {
      animProps.addProperty("ADBE Text Opacity").setValue(0);
      var posProp = animProps.addProperty("ADBE Text Position");
      posProp.setValue([0, 40]);
      var sel = selectors.addProperty("ADBE Text Selector");
      var startProp = sel.property("ADBE Text Percent Start");
      startProp.setValueAtTime(sTime, 0);
      startProp.setValueAtTime(eTime, 100);
      try {
        var adv = sel.property("ADBE Text Range Advanced");
        if (adv && adv.property("ADBE Text Range Shape")) {
          adv.property("ADBE Text Range Shape").setValue(2); // Ramp Up
          if (adv.property("ADBE Text Range Ease High")) adv.property("ADBE Text Range Ease High").setValue(50);
          if (adv.property("ADBE Text Range Ease Low")) adv.property("ADBE Text Range Ease Low").setValue(50);
        }
      } catch(e){}
    } else if (preset === 'slide_in_chars') {
      animProps.addProperty("ADBE Text Opacity").setValue(0);
      var posProp = animProps.addProperty("ADBE Text Position");
      posProp.setValue([0, 100]);
      var sel = selectors.addProperty("ADBE Text Selector");
      var startProp = sel.property("ADBE Text Percent Start");
      startProp.setValueAtTime(sTime, 0);
      startProp.setValueAtTime(eTime, 100);
    } else if (preset === 'scale_pop_chars') {
      var scProp = null;
      if (animProps.canAddProperty("ADBE Text Scale 3D")) scProp = animProps.addProperty("ADBE Text Scale 3D");
      else if (animProps.canAddProperty("ADBE Text Scale")) scProp = animProps.addProperty("ADBE Text Scale");
      if (scProp) scProp.setValue([0, 0, 0]);
      var sel = selectors.addProperty("ADBE Text Selector");
      var startProp = sel.property("ADBE Text Percent Start");
      startProp.setValueAtTime(sTime, 0);
      startProp.setValueAtTime(eTime, 100);
    } else if (preset === '3d_flip_chars') {
      try {
        textProps.property("ADBE Text More Options").property("ADBE Text Animate 3D").setValue(1);
      } catch(e){}
      animProps.addProperty("ADBE Text Opacity").setValue(0);
      var rotY = animProps.addProperty("ADBE Text Rotation Y");
      rotY.setValue(-90);
      var sel = selectors.addProperty("ADBE Text Selector");
      var startProp = sel.property("ADBE Text Percent Start");
      startProp.setValueAtTime(sTime, 0);
      startProp.setValueAtTime(eTime, 100);
    } else if (preset === 'tracking_expand') {
      var trk = animProps.addProperty("ADBE Text Tracking Amount");
      trk.setValueAtTime(sTime, 80);
      trk.setValueAtTime(eTime, 0);
      animProps.addProperty("ADBE Text Opacity").setValueAtTime(sTime, 0);
      animProps.addProperty("ADBE Text Opacity").setValueAtTime(eTime, 100);
    } else if (preset === 'wiggle_wave') {
      var wig = selectors.addProperty("ADBE Text Wiggly Selector");
      var pProp = animProps.addProperty("ADBE Text Position");
      pProp.setValue([0, 20]);
      var rProp = animProps.addProperty("ADBE Text Rotation");
      rProp.setValue(10);
    } else if (preset === 'glitch_decoder') {
      var cr = animProps.addProperty("ADBE Text Character Range");
      cr.setValue(15);
      var sel = selectors.addProperty("ADBE Text Selector");
      var startProp = sel.property("ADBE Text Percent Start");
      startProp.setValueAtTime(sTime, 0);
      startProp.setValueAtTime(eTime, 100);
    }

    // Custom properties if provided
    var customProps = ${JSON.stringify(params.properties || null)};
    if (customProps) {
      if (customProps.opacity !== undefined) {
        animProps.addProperty("ADBE Text Opacity").setValue(customProps.opacity);
      }
      if (customProps.position !== undefined) {
        if (customProps.position.length === 3) {
          try {
            textProps.property("ADBE Text More Options").property("ADBE Text Animate 3D").setValue(1);
            animProps.addProperty("ADBE Text Position 3D").setValue(customProps.position);
          } catch(e){
            animProps.addProperty("ADBE Text Position").setValue([customProps.position[0], customProps.position[1]]);
          }
        } else {
          animProps.addProperty("ADBE Text Position").setValue(customProps.position);
        }
      }
      if (customProps.scale !== undefined) {
        animProps.addProperty("ADBE Text Scale").setValue(customProps.scale);
      }
      if (customProps.rotation !== undefined) {
        animProps.addProperty("ADBE Text Rotation").setValue(customProps.rotation);
      }
      if (customProps.rotationX !== undefined) {
        try {
          textProps.property("ADBE Text More Options").property("ADBE Text Animate 3D").setValue(1);
          animProps.addProperty("ADBE Text Rotation X").setValue(customProps.rotationX);
        } catch(e){}
      }
      if (customProps.rotationY !== undefined) {
        try {
          textProps.property("ADBE Text More Options").property("ADBE Text Animate 3D").setValue(1);
          animProps.addProperty("ADBE Text Rotation Y").setValue(customProps.rotationY);
        } catch(e){}
      }
      if (customProps.tracking !== undefined) {
        animProps.addProperty("ADBE Text Tracking Amount").setValue(customProps.tracking);
      }
      if (customProps.blur !== undefined) {
        animProps.addProperty("ADBE Text Blur").setValue(customProps.blur);
      }
      if (customProps.fillColor !== undefined) {
        animProps.addProperty("ADBE Text Fill Color").setValue(customProps.fillColor);
      }
      if (customProps.strokeColor !== undefined) {
        animProps.addProperty("ADBE Text Stroke Color").setValue(customProps.strokeColor);
      }
      if (customProps.strokeWidth !== undefined) {
        animProps.addProperty("ADBE Text Stroke Width").setValue(customProps.strokeWidth);
      }
    }

    // Custom range selector configuration
    var customSel = ${JSON.stringify(params.rangeSelector || null)};
    if (customSel && preset === 'custom') {
      var sel = selectors.addProperty("ADBE Text Range Selector");
      if (customSel.start !== undefined) sel.property("ADBE Text Range Start").setValue(customSel.start);
      if (customSel.end !== undefined) sel.property("ADBE Text Range End").setValue(customSel.end);
      if (customSel.offset !== undefined) sel.property("ADBE Text Range Offset").setValue(customSel.offset);

      if (customSel.animateOverTime) {
        var aProp = customSel.animateOverTime.type === 'offset'
          ? sel.property("ADBE Text Range Offset")
          : (customSel.animateOverTime.type === 'end' ? sel.property("ADBE Text Range End") : sel.property("ADBE Text Range Start"));
        aProp.setValueAtTime(customSel.animateOverTime.startTime, 0);
        aProp.setValueAtTime(customSel.animateOverTime.endTime, 100);
      }

      var adv = sel.property("ADBE Text Range Advanced");
      if (adv) {
        if (customSel.basedOn) {
          var bMap = { "characters": 1, "words": 3, "lines": 4 };
          if (bMap[customSel.basedOn]) adv.property("ADBE Text Range Units").setValue(bMap[customSel.basedOn]);
        }
        if (customSel.shape) {
          var shMap = { "square": 1, "ramp_up": 2, "ramp_down": 3, "triangle": 4, "round": 5, "smooth": 6 };
          if (shMap[customSel.shape]) adv.property("ADBE Text Range Shape").setValue(shMap[customSel.shape]);
        }
        if (customSel.easeHigh !== undefined) adv.property("ADBE Text Range Ease High").setValue(customSel.easeHigh);
        if (customSel.easeLow !== undefined) adv.property("ADBE Text Range Ease Low").setValue(customSel.easeLow);
        if (customSel.randomizeOrder !== undefined) adv.property("ADBE Text Randomize Order").setValue(Boolean(customSel.randomizeOrder));
      }
    }

    return {
      layerName: layer.name,
      animatorName: animator.name,
      preset: preset,
      startTime: sTime,
      endTime: eTime
    };
  })()`;
}



