/**
 * ExtendScript helper generators for After Effects MCP
 */
export declare const ExtendScriptHelpers = "\nfunction __findComp(compName) {\n  if (compName) {\n    for (var i = 1; i <= app.project.numItems; i++) {\n      var item = app.project.item(i);\n      if (item instanceof CompItem && item.name === compName) {\n        return item;\n      }\n    }\n    throw new Error(\"Composition '\" + compName + \"' not found.\");\n  }\n  if (app.project.activeItem && app.project.activeItem instanceof CompItem) {\n    return app.project.activeItem;\n  }\n  for (var j = 1; j <= app.project.numItems; j++) {\n    if (app.project.item(j) instanceof CompItem) {\n      return app.project.item(j);\n    }\n  }\n  throw new Error(\"No composition found in project.\");\n}\n\nfunction __findLayer(comp, layerRef) {\n  if (typeof layerRef === \"number\") {\n    if (layerRef >= 1 && layerRef <= comp.numLayers) {\n      return comp.layer(layerRef);\n    }\n    throw new Error(\"Layer index \" + layerRef + \" out of range (1-\" + comp.numLayers + \").\");\n  }\n  if (typeof layerRef === \"string\") {\n    for (var i = 1; i <= comp.numLayers; i++) {\n      if (comp.layer(i).name === layerRef) {\n        return comp.layer(i);\n      }\n    }\n    throw new Error(\"Layer '\" + layerRef + \"' not found in comp '\" + comp.name + \"'.\");\n  }\n  throw new Error(\"Invalid layer reference: \" + layerRef);\n}\n\nfunction __findProp(layer, propName) {\n  var propMap = {\n    \"position\": \"ADBE Position\",\n    \"scale\": \"ADBE Scale\",\n    \"rotation\": \"ADBE Rotate Z\",\n    \"rotationx\": \"ADBE Rotate X\",\n    \"rotationy\": \"ADBE Rotate Y\",\n    \"rotationz\": \"ADBE Rotate Z\",\n    \"opacity\": \"ADBE Opacity\",\n    \"anchorpoint\": \"ADBE Anchor Point\",\n    \"pointofinterest\": \"ADBE Point of Interest\",\n    \"zoom\": \"ADBE Zoom\",\n    \"focusdistance\": \"ADBE Focus Distance\",\n    \"aperture\": \"ADBE Aperture\",\n    \"blurlevel\": \"ADBE Blur Level\"\n  };\n\n  var lower = propName.toLowerCase().replace(/\\s+/g, \"\");\n  if (propMap[lower]) {\n    var transform = layer.property(\"ADBE Transform Group\");\n    if (transform && transform.property(propMap[lower])) {\n      return transform.property(propMap[lower]);\n    }\n    var camOptions = layer.property(\"ADBE Camera Options Group\");\n    if (camOptions && camOptions.property(propMap[lower])) {\n      return camOptions.property(propMap[lower]);\n    }\n  }\n\n  // Check direct property or nested path \"Group/Prop\"\n  if (propName.indexOf(\"/\") !== -1) {\n    var parts = propName.split(\"/\");\n    var curr = layer;\n    for (var p = 0; p < parts.length; p++) {\n      if (!curr) break;\n      curr = curr.property(parts[p]);\n    }\n    if (curr) return curr;\n  }\n\n  var direct = layer.property(propName);\n  if (direct) return direct;\n\n  var xform = layer.property(\"ADBE Transform Group\");\n  if (xform && xform.property(propName)) return xform.property(propName);\n\n  // Search effects group\n  var effects = layer.property(\"ADBE Effect Parade\");\n  if (effects) {\n    for (var e = 1; e <= effects.numProperties; e++) {\n      var eff = effects.property(e);\n      if (eff.name === propName || eff.matchName === propName) return eff;\n      for (var ep = 1; ep <= eff.numProperties; ep++) {\n        var param = eff.property(ep);\n        if (param.name === propName || param.matchName === propName) return param;\n      }\n    }\n  }\n\n  throw new Error(\"Property '\" + propName + \"' not found on layer '\" + layer.name + \"'.\");\n}\n\nfunction __getLayerType(layer) {\n  if (layer instanceof CameraLayer) return \"Camera\";\n  if (layer instanceof LightLayer) return \"Light\";\n  if (layer instanceof ShapeLayer) return \"Shape\";\n  if (layer instanceof TextLayer) return \"Text\";\n  if (layer.nullLayer) return \"Null\";\n  if (layer.source instanceof CompItem) return \"Precomp\";\n  if (layer.source instanceof FootageItem) {\n    if (layer.source.mainSource instanceof SolidSource) return \"Solid\";\n    return \"Footage\";\n  }\n  return \"AVLayer\";\n}\n\nfunction __setKeyTemporalEase(prop, kIdx, inEaseObj, outEaseObj) {\n  var isSpatial = false;\n  try {\n    if (prop.propertyValueType === PropertyValueType.TwoD_SPATIAL || prop.propertyValueType === PropertyValueType.ThreeD_SPATIAL) {\n      isSpatial = true;\n    }\n  } catch(e) {}\n\n  if (isSpatial) {\n    prop.setTemporalEaseAtKey(kIdx, [inEaseObj], [outEaseObj]);\n  } else {\n    var val = prop.keyValue(kIdx);\n    var dims = (val instanceof Array) ? val.length : 1;\n    var inArr = [], outArr = [];\n    for (var d = 0; d < dims; d++) {\n      inArr.push(inEaseObj);\n      outArr.push(outEaseObj);\n    }\n    try {\n      prop.setTemporalEaseAtKey(kIdx, inArr, outArr);\n    } catch(err) {\n      try { prop.setTemporalEaseAtKey(kIdx, [inEaseObj], [outEaseObj]); } catch(err2) {}\n    }\n  }\n}\n";
export declare function scriptCreateComposition(params: {
    name: string;
    width?: number;
    height?: number;
    pixelAspectRatio?: number;
    duration?: number;
    frameRate?: number;
    bgColor?: [number, number, number];
}): string;
export declare function scriptRenameComposition(params: {
    compName?: string;
    newName: string;
}): string;
export declare function scriptSetCompositionProperties(params: {
    compName?: string;
    newName?: string;
    width?: number;
    height?: number;
    duration?: number;
    frameRate?: number;
    pixelAspectRatio?: number;
    bgColor?: [number, number, number];
}): string;
export declare function scriptSetLayerKeyframe(params: {
    compName?: string;
    layerName?: string;
    layerIndex?: number;
    propertyName: string;
    time: number;
    value: number | number[];
    keyframeInterpolation?: 'linear' | 'ease' | 'easeIn' | 'easeOut' | 'hold';
}): string;
export declare function scriptSetLayerExpression(params: {
    compName?: string;
    layerName?: string;
    layerIndex?: number;
    propertyName: string;
    expression: string | null;
    enabled?: boolean;
}): string;
export declare function scriptSetLayerProperties(params: {
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
}): string;
export declare function scriptBatchSetLayerProperties(params: {
    compName?: string;
    updates: Array<{
        layerName?: string;
        layerIndex?: number;
        properties: Record<string, any>;
    }>;
}): string;
export declare function scriptGetLayerInfo(params: {
    compName?: string;
    layerName?: string;
    layerIndex?: number;
}): string;
export declare function scriptCreateCamera(params: {
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
}): string;
export declare function scriptSetCameraProperties(params: {
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
}): string;
export declare function scriptApplyCameraMove(params: {
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
}): string;
export declare function scriptCreateCameraRig(params: {
    compName?: string;
    cameraName?: string;
    rigName?: string;
    targetPosition?: [number, number, number];
    distance?: number;
}): string;
export declare function scriptTrackCameraToLayer(params: {
    compName?: string;
    cameraName?: string;
    cameraIndex?: number;
    targetLayerName?: string;
    targetLayerIndex?: number;
    trackMode?: 'look_at' | 'follow_position' | 'focus_distance';
}): string;
export declare function scriptCreateNullObject(params: {
    compName?: string;
    name?: string;
    duration?: number;
}): string;
export declare function scriptDuplicateLayer(params: {
    compName?: string;
    layerName?: string;
    layerIndex?: number;
}): string;
export declare function scriptDeleteLayer(params: {
    compName?: string;
    layerName?: string;
    layerIndex?: number;
}): string;
export declare function scriptPrecomposeLayers(params: {
    compName?: string;
    layerIndices?: number[];
    layerNames?: string[];
    precompName: string;
}): string;
export declare function scriptReorderLayer(params: {
    compName?: string;
    layerName?: string;
    layerIndex?: number;
    operation: 'moveBefore' | 'moveAfter' | 'moveToBeginning' | 'moveToEnd' | 'setIndex';
    targetLayerName?: string;
    targetLayerIndex?: number;
    newIndex?: number;
}): string;
export declare function scriptSetLayerMask(params: {
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
}): string;
export declare function scriptGetInstalledPlugins(params: {
    category?: string;
    search?: string;
}): string;
export declare function scriptApplyEffect(params: {
    compName?: string;
    layerName?: string;
    layerIndex?: number;
    effectName: string;
    properties?: Record<string, any>;
}): string;
export declare function scriptSetEffectProperties(params: {
    compName?: string;
    layerName?: string;
    layerIndex?: number;
    effectName?: string;
    effectIndex?: number;
    properties: Record<string, any>;
}): string;
export declare function scriptGetEffectProperties(params: {
    compName?: string;
    layerName?: string;
    layerIndex?: number;
    effectName?: string;
    effectIndex?: number;
}): string;
export declare function scriptRemoveEffect(params: {
    compName?: string;
    layerName?: string;
    layerIndex?: number;
    effectName?: string;
    effectIndex?: number;
}): string;
export declare function scriptCreateTextLayer(params: {
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
    effects?: Array<{
        effectName: string;
        properties?: Record<string, any>;
    }>;
}): string;
export declare function scriptCreateSolidLayer(params: {
    compName?: string;
    name?: string;
    color: [number, number, number];
    width?: number;
    height?: number;
    duration?: number;
}): string;
export declare function scriptGetProjectInfo(): string;
export declare function scriptSaveProject(savePath?: string): string;
export declare function scriptUndo(): string;
export declare function scriptImportAsset(params: {
    filePath: string;
    compName?: string;
    sequence?: boolean;
    convertToShape?: boolean;
    isThreeD?: boolean;
    position?: [number, number] | [number, number, number];
    scale?: [number, number] | [number, number, number];
    name?: string;
}): string;
export declare function scriptCreate3DLayer(params: {
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
}): string;
export declare function scriptCreateLight(params: {
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
}): string;
export declare function scriptSet3DLayerTransform(params: {
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
}): string;
export declare function scriptAddLayerMask(params: {
    compName?: string;
    layerName?: string;
    layerIndex?: number;
    maskName?: string;
    shapeType: 'rectangle' | 'ellipse' | 'polygon' | 'custom';
    bounds?: [number, number, number, number];
    vertices?: [number, number][];
    inTangents?: [number, number][];
    outTangents?: [number, number][];
    closed?: boolean;
    maskMode?: 'add' | 'subtract' | 'intersect' | 'lighten' | 'darken' | 'difference' | 'none';
    feather?: [number, number];
    opacity?: number;
    expansion?: number;
    inverted?: boolean;
}): string;
export declare function scriptGetLayerMaterialOptions(params: {
    compName?: string;
    layerName?: string;
    layerIndex?: number;
}): string;
export declare function scriptSetLayerMaterialOptions(params: {
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
}): string;
export declare function scriptGetCompRenderer(params: {
    compName?: string;
}): string;
export declare function scriptSetCompRenderer(params: {
    compName?: string;
    renderer: string;
}): string;
export declare function scriptSetKeyframeVelocity(params: {
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
}): string;
export declare function scriptGetKeyframeInfo(params: {
    compName?: string;
    layerName?: string;
    layerIndex?: number;
    propertyName: string;
}): string;
export declare function scriptExportFrame(params: {
    compName?: string;
    time?: number;
    frame?: number;
    outputPath: string;
}): string;
export declare function scriptExportPreviewVideo(params: {
    compName?: string;
    startFrame?: number;
    endFrame?: number;
    startTime?: number;
    endTime?: number;
    quality?: 'low' | 'draft' | 'medium' | 'high';
    resolution?: 'quarter' | 'half' | 'full';
    outputPath: string;
}): string;
export declare function scriptExportWithAME(params: {
    compName?: string;
    outputPath?: string;
    presetPath?: string;
    renderImmediately?: boolean;
}): string;
export declare function scriptSetEffectPropertyKeyframe(params: {
    compName?: string;
    layerName?: string;
    layerIndex?: number;
    effectName?: string;
    effectIndex?: number;
    propertyName: string;
    time: number;
    value: any;
    keyframeInterpolation?: 'linear' | 'ease' | 'easeIn' | 'easeOut' | 'hold';
}): string;
export declare function scriptSetEffectEnabled(params: {
    compName?: string;
    layerName?: string;
    layerIndex?: number;
    effectName?: string;
    effectIndex?: number;
    enabled: boolean;
}): string;
export declare function scriptReorderEffect(params: {
    compName?: string;
    layerName?: string;
    layerIndex?: number;
    effectName?: string;
    effectIndex?: number;
    newIndex: number;
}): string;
export declare function scriptFormatTextLayer(params: {
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
}): string;
export declare function scriptGetAvailableFonts(): string;
export declare function scriptAddTextAnimator(params: {
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
}): string;
