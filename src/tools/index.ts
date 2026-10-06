import fs from 'fs';
import path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeManager } from '../bridge/bridge-manager.js';
import { ConfigManager } from '../config/index.js';
import { HistoryManager } from '../history/index.js';
import { AIService } from '../ai/ai-service.js';
import { installBridgeScript } from '../scripts/installer.js';
import * as snippets from '../extendscript/snippets.js';

export function registerAllTools(server: McpServer): void {
  const bridge = BridgeManager.getInstance();
  const config = ConfigManager.getInstance();
  const history = HistoryManager.getInstance();
  const aiService = AIService.getInstance();

  function formatResponse(data: any) {
    return {
      content: [
        {
          type: 'text' as const,
          text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  // --- 1. create-composition ---
  server.tool(
    'create-composition',
    'Create a new composition in Adobe After Effects',
    {
      name: z.string().describe('Name of the new composition'),
      width: z.number().optional().describe('Width in pixels (default: 1920)'),
      height: z.number().optional().describe('Height in pixels (default: 1080)'),
      pixelAspectRatio: z.number().optional().describe('Pixel aspect ratio (default: 1.0)'),
      duration: z.number().optional().describe('Duration in seconds (default: 10.0)'),
      frameRate: z.number().optional().describe('Frame rate in FPS (default: 30.0)'),
      bgColor: z.tuple([z.number(), z.number(), z.number()]).optional().describe('RGB background color [0-1, 0-1, 0-1] (default: [0,0,0])'),
    },
    async (params) => {
      const script = snippets.scriptCreateComposition(params);
      const res = await bridge.execute('create-composition', script, `Create composition '${params.name}'`, params);
      return formatResponse(res);
    }
  );

  // --- renameComposition ---
  server.tool(
    'renameComposition',
    'Rename an existing composition in Adobe After Effects',
    {
      compName: z.string().optional().describe('Current name of the composition (defaults to active composition)'),
      newName: z.string().describe('New name for the composition'),
    },
    async (params) => {
      const script = snippets.scriptRenameComposition(params);
      const res = await bridge.execute('renameComposition', script, `Rename composition to '${params.newName}'`, params);
      return formatResponse(res);
    }
  );

  // --- setCompositionProperties ---
  server.tool(
    'setCompositionProperties',
    'Modify properties of an existing composition including name, dimensions (width/height), duration, framerate, and background color',
    {
      compName: z.string().optional().describe('Composition name (defaults to active composition)'),
      newName: z.string().optional().describe('Optional new name for the composition'),
      width: z.number().optional().describe('New width in pixels'),
      height: z.number().optional().describe('New height in pixels'),
      duration: z.number().optional().describe('New duration in seconds'),
      frameRate: z.number().optional().describe('New frame rate in FPS'),
      pixelAspectRatio: z.number().optional().describe('Pixel aspect ratio'),
      bgColor: z.tuple([z.number(), z.number(), z.number()]).optional().describe('RGB background color [0-1, 0-1, 0-1]'),
    },
    async (params) => {
      const script = snippets.scriptSetCompositionProperties(params);
      const res = await bridge.execute('setCompositionProperties', script, `Update properties of composition`, params);
      return formatResponse(res);
    }
  );

  // --- 2. run-script ---
  server.tool(
    'run-script',
    'Execute arbitrary ExtendScript JavaScript code directly inside Adobe After Effects with full DOM access',
    {
      script: z.string().describe('The ExtendScript JavaScript code to execute'),
      description: z.string().optional().describe('Optional brief description of what the script does'),
    },
    async (params) => {
      const wrapped = `(function() {
        ${snippets.ExtendScriptHelpers}
        ${params.script}
      })()`;
      const res = await bridge.execute('run-script', wrapped, params.description || 'Run custom script', { scriptLength: params.script.length });
      return formatResponse(res);
    }
  );

  // --- 3. get-results ---
  server.tool(
    'get-results',
    'Retrieve results of a previously executed command or the latest command result',
    {
      commandId: z.string().optional().describe('Specific command ID to retrieve, or omit for the latest result'),
    },
    async (params) => {
      const res = bridge.getLastResult(params.commandId);
      if (!res) {
        return formatResponse({
          success: false,
          message: params.commandId ? `No result found for command ID '${params.commandId}'` : 'No recent command results found.',
        });
      }
      return formatResponse(res);
    }
  );

  // --- 4. get-help ---
  server.tool(
    'get-help',
    'Get help, command list, property reference, and troubleshooting guidance for After Effects MCP',
    {
      topic: z.enum(['overview', 'tools', 'properties', 'effects', 'bridge', 'troubleshooting']).optional().describe('Help topic'),
    },
    async (params) => {
      const topic = params.topic || 'overview';
      const helpData: Record<string, string> = {
        overview: `# After Effects MCP Server Overview
This MCP server allows AI assistants to directly manipulate Adobe After Effects via ExtendScript.
It connects to After Effects either through the ScriptUI panel bridge (Window > mcp-bridge-auto.jsx) or direct CLI fallback.
All operations support automatic project saving and history logging with undo/rollback support.`,
        tools: `# Available Tools:
- create-composition: Create a new composition
- run-script: Execute arbitrary ExtendScript code
- get-results: Get command execution results
- setLayerKeyframe: Set keyframe values and interpolation
- setLayerExpression: Add or modify expressions
- setLayerProperties: Set transform and layer attributes
- batchSetLayerProperties: Modify multiple layers at once
- createCamera: Add 1-node or 2-node 3D camera with focal presets, depth of field, and optional rig
- setCameraProperties: Modify camera zoom, depth of field, focus distance, aperture, rotations
- applyCameraMove: Perform cinematic camera moves (orbit, dolly in/out, truck, boom, pan, whip pan, dolly zoom, fly through, spiral, handheld shake)
- createCameraRig: Create standard 3D camera rig with orbit & target null controllers
- trackCameraToLayer: Lock camera look-at, follow position, or auto-focus to target layer
- duplicateLayer: Duplicate a layer
- deleteLayer: Delete a layer
- setLayerMask: Add/edit masks
- getInstalledPlugins: Query available effects and plugins
- applyEffect: Add an effect to a layer
- setEffectProperties: Modify effect parameters
- getEffectProperties: Query all parameters of an effect
- removeEffect: Remove an effect from a layer
- createTextLayer: Add 2D or 3D text layer with full typography and effects
- formatTextLayer: Modify text content, font, colors, tracking & formatting
- getAvailableFonts: List installed PostScript fonts in AE
- addTextAnimator: Add text animators (range selector, wiggle, 3D flip, typewriter, presets)
- createSolidLayer: Add solid color layer
- getProjectInfo: Query project and compositions
- saveProject: Save project or snapshot
- getHistory: Query operation history
- rollback: Undo previous action
- configureSettings: Update auto-save and history settings
- installBridge: Auto-install bridge JSX panel to AE`,
        properties: `# Layer Properties Reference:
- position: [x, y] or [x, y, z]
- scale: [x, y] or [x, y, z] (100 = 100%)
- rotation / rotationX / rotationY / rotationZ: degrees
- opacity: 0 - 100
- blendMode: NORMAL, ADD, MULTIPLY, SCREEN, OVERLAY, etc.
- threeDLayer: true | false
- trackMatteType: NO_TRACK_MATTE, ALPHA, ALPHA_INVERTED, LUMA, LUMA_INVERTED`,
        effects: `# Plugins & Effects:
Any installed After Effects effect or third-party plugin (Element 3D, Trapcode, Sapphire, Deep Glow, etc.) can be applied using its display name or matchName via applyEffect.
Use getInstalledPlugins to discover installed effects or test compatibility.`,
        bridge: `# Bridge Setup:
1. Run tool 'installBridge' or copy 'mcp-bridge-auto.jsx' to AE's ScriptUI Panels directory.
2. In After Effects: Window > mcp-bridge-auto.jsx.
3. Check 'Auto-run commands'.
4. Ensure AE Preferences > Scripting & Expressions > 'Allow Scripts to Write Files and Access Network' is enabled.`,
        troubleshooting: `# Troubleshooting:
1. Command timed out: Check if AE is open and mcp-bridge-auto.jsx is running.
2. Permission error: Enable 'Allow Scripts to Write Files and Access Network' in AE preferences.
3. Property not found: Ensure layer is 3D if accessing Z rotation, or verify property path.`,
      };

      return formatResponse({
        topic,
        content: helpData[topic] || helpData.overview,
      });
    }
  );

  // --- 5. setLayerKeyframe ---
  server.tool(
    'setLayerKeyframe',
    'Add a keyframe to a layer property at a specific timestamp with optional interpolation',
    {
      compName: z.string().optional().describe('Composition name (defaults to active composition)'),
      layerName: z.string().optional().describe('Layer name'),
      layerIndex: z.number().optional().describe('Layer index (1-based)'),
      propertyName: z.string().describe('Property name (e.g. "Position", "Scale", "Rotation", "Opacity", or effect property)'),
      time: z.number().describe('Time in seconds where the keyframe should be set'),
      value: z.union([z.number(), z.array(z.number())]).describe('Keyframe value (number or array of numbers)'),
      keyframeInterpolation: z.enum(['linear', 'ease', 'easeIn', 'easeOut', 'hold']).optional().describe('Keyframe easing type'),
    },
    async (params) => {
      const script = snippets.scriptSetLayerKeyframe(params);
      const res = await bridge.execute(
        'setLayerKeyframe',
        script,
        `Set keyframe on ${params.propertyName} at ${params.time}s`,
        params
      );
      return formatResponse(res);
    }
  );

  // --- 6. setLayerExpression ---
  server.tool(
    'setLayerExpression',
    'Add, modify, or remove an expression on a layer property',
    {
      compName: z.string().optional().describe('Composition name'),
      layerName: z.string().optional().describe('Layer name'),
      layerIndex: z.number().optional().describe('Layer index'),
      propertyName: z.string().describe('Property name (e.g. "Position", "Opacity", "Rotation")'),
      expression: z.string().nullable().describe('Expression string (e.g. "wiggle(2, 20)"), or null/empty string to remove expression'),
      enabled: z.boolean().optional().describe('Whether the expression is enabled (default: true)'),
    },
    async (params) => {
      const script = snippets.scriptSetLayerExpression(params);
      const res = await bridge.execute(
        'setLayerExpression',
        script,
        `Set expression on ${params.propertyName}`,
        params
      );
      return formatResponse(res);
    }
  );

  // --- 7. setLayerProperties ---
  server.tool(
    'setLayerProperties',
    'Set properties of a layer (position, scale, rotation, opacity, blendMode, threeDLayer, trackMatteType, enabled, etc.)',
    {
      compName: z.string().optional().describe('Composition name'),
      layerName: z.string().optional().describe('Layer name'),
      layerIndex: z.number().optional().describe('Layer index'),
      properties: z.object({
        position: z.array(z.number()).optional().describe('[x, y] or [x, y, z]'),
        scale: z.array(z.number()).optional().describe('[x, y] or [x, y, z] (100 = 100%)'),
        rotation: z.number().optional().describe('Rotation in degrees'),
        rotationX: z.number().optional().describe('X rotation for 3D layers'),
        rotationY: z.number().optional().describe('Y rotation for 3D layers'),
        rotationZ: z.number().optional().describe('Z rotation for 3D layers'),
        opacity: z.number().optional().describe('Opacity 0-100'),
        blendMode: z.string().optional().describe('Blend mode (NORMAL, ADD, MULTIPLY, SCREEN, OVERLAY, etc.)'),
        threeDLayer: z.boolean().optional().describe('Enable/disable 3D layer'),
        trackMatteType: z.string().optional().describe('Track matte type (NO_TRACK_MATTE, ALPHA, ALPHA_INVERTED, LUMA, LUMA_INVERTED)'),
        enabled: z.boolean().optional().describe('Layer visibility/enabled state'),
        name: z.string().optional().describe('Rename layer'),
        inPoint: z.number().optional().describe('In point in seconds'),
        outPoint: z.number().optional().describe('Out point in seconds'),
        startTime: z.number().optional().describe('Start time in seconds'),
        comment: z.string().optional().describe('Layer comment text'),
        label: z.number().optional().describe('Label color index (0-16)'),
      }).describe('Properties object to update'),
    },
    async (params) => {
      const script = snippets.scriptSetLayerProperties(params);
      const res = await bridge.execute(
        'setLayerProperties',
        script,
        `Set properties on layer ${params.layerName || params.layerIndex || 'active'}`,
        params
      );
      return formatResponse(res);
    }
  );

  // --- 8. batchSetLayerProperties ---
  server.tool(
    'batchSetLayerProperties',
    'Apply property updates to multiple layers simultaneously in a single transaction',
    {
      compName: z.string().optional().describe('Composition name'),
      updates: z.array(
        z.object({
          layerName: z.string().optional().describe('Layer name'),
          layerIndex: z.number().optional().describe('Layer index'),
          properties: z.record(z.string(), z.any()).describe('Properties to set on this layer'),
        })
      ).describe('Array of layer property update operations'),
    },
    async (params) => {
      const script = snippets.scriptBatchSetLayerProperties(params);
      const res = await bridge.execute(
        'batchSetLayerProperties',
        script,
        `Batch set properties on ${params.updates.length} layers`,
        params
      );
      return formatResponse(res);
    }
  );

  // --- 9. getLayerInfo ---
  server.tool(
    'getLayerInfo',
    'Get detailed information about a layer (position, scale, rotation, 3D status, effects, masks) or all layers in a composition',
    {
      compName: z.string().optional().describe('Composition name'),
      layerName: z.string().optional().describe('Layer name (optional)'),
      layerIndex: z.number().optional().describe('Layer index (optional)'),
    },
    async (params) => {
      const script = snippets.scriptGetLayerInfo(params);
      const res = await bridge.execute(
        'getLayerInfo',
        script,
        `Get layer info for ${params.layerName || params.layerIndex || 'all layers'}`,
        params
      );
      return formatResponse(res);
    }
  );

  // --- 10. createCamera ---
  server.tool(
    'createCamera',
    'Create a 1-node or 2-node 3D camera layer with focal presets, depth of field, aperture, and optional camera rig',
    {
      compName: z.string().optional().describe('Composition name (defaults to active comp)'),
      name: z.string().optional().describe('Camera layer name (default: "Camera 1")'),
      cameraType: z.enum(['one-node', 'two-node']).optional().describe('Camera type: "one-node" (free rotation without target point) or "two-node" (aims at Point of Interest, default)'),
      preset: z.enum(['15mm', '20mm', '24mm', '28mm', '35mm', '50mm', '80mm', '135mm', '200mm', 'custom']).optional().describe('Focal length preset (e.g. "35mm", "50mm")'),
      focalLength: z.number().optional().describe('Custom focal length in mm'),
      zoom: z.number().optional().describe('Camera zoom value in pixels (overrides focalLength)'),
      centerPoint: z.tuple([z.number(), z.number()]).optional().describe('Initial center point [x, y] (defaults to comp center)'),
      position: z.tuple([z.number(), z.number(), z.number()]).optional().describe('3D position [x, y, z]'),
      pointOfInterest: z.tuple([z.number(), z.number(), z.number()]).optional().describe('3D Point of Interest [x, y, z] (for two-node camera)'),
      orientation: z.tuple([z.number(), z.number(), z.number()]).optional().describe('3D orientation [x, y, z] in degrees'),
      rotationX: z.number().optional().describe('X rotation in degrees'),
      rotationY: z.number().optional().describe('Y rotation in degrees'),
      rotationZ: z.number().optional().describe('Z rotation in degrees'),
      depthOfField: z.boolean().optional().describe('Enable/disable Depth of Field blur'),
      focusDistance: z.number().optional().describe('Focus distance in pixels (defaults to distance between camera and Point of Interest)'),
      aperture: z.number().optional().describe('Aperture size in pixels (controls background blur amount)'),
      blurLevel: z.number().optional().describe('Blur level percentage (default: 100)'),
      irisShape: z.enum(['fast_rectangle', 'triangle', 'cross', 'pentagon', 'hexagon', 'heptagon', 'octagon']).optional().describe('Iris bokeh shape'),
      createRig: z.boolean().optional().describe('Automatically create a 3D Orbit Null rig parented to the camera'),
      rigName: z.string().optional().describe('Name of the camera controller null (default: "Camera Controller")'),
    },
    async (params) => {
      const script = snippets.scriptCreateCamera(params as any);
      const res = await bridge.execute('createCamera', script, `Create camera '${params.name || 'Camera 1'}'`, params);
      return formatResponse(res);
    }
  );

  // --- 10b. setCameraProperties ---
  server.tool(
    'setCameraProperties',
    'Set or modify properties on an existing 3D camera layer (position, pointOfInterest, rotations, zoom, depthOfField, focusDistance, aperture, iris, or auto-lock focus to a layer)',
    {
      compName: z.string().optional().describe('Composition name (defaults to active comp)'),
      cameraName: z.string().optional().describe('Camera layer name'),
      cameraIndex: z.number().optional().describe('Camera layer index (1-based)'),
      cameraType: z.enum(['one-node', 'two-node']).optional().describe('Switch camera between one-node (no auto-orient) and two-node (auto-orient to point of interest)'),
      position: z.tuple([z.number(), z.number(), z.number()]).optional().describe('New 3D position [x, y, z]'),
      pointOfInterest: z.tuple([z.number(), z.number(), z.number()]).optional().describe('New 3D Point of Interest [x, y, z]'),
      orientation: z.tuple([z.number(), z.number(), z.number()]).optional().describe('3D orientation [x, y, z] in degrees'),
      rotationX: z.number().optional().describe('X rotation in degrees'),
      rotationY: z.number().optional().describe('Y rotation in degrees'),
      rotationZ: z.number().optional().describe('Z rotation in degrees'),
      zoom: z.number().optional().describe('Camera zoom / focal length in pixels'),
      depthOfField: z.boolean().optional().describe('Enable/disable Depth of Field'),
      focusDistance: z.number().optional().describe('Focus distance in pixels'),
      aperture: z.number().optional().describe('Aperture in pixels (controls blur strength)'),
      blurLevel: z.number().optional().describe('Blur level percentage (0 - 500)'),
      irisShape: z.enum(['fast_rectangle', 'triangle', 'cross', 'pentagon', 'hexagon', 'heptagon', 'octagon']).optional().describe('Iris bokeh blade shape'),
      irisRotation: z.number().optional().describe('Iris rotation angle in degrees'),
      irisRoundness: z.number().optional().describe('Iris roundness percentage'),
      irisAspectRatio: z.number().optional().describe('Iris aspect ratio (anamorphic bokeh stretching)'),
      lockFocusToLayer: z.union([z.string(), z.number()]).optional().describe('Name or index of target layer to permanently lock camera focusDistance to, keeping the target razor sharp'),
    },
    async (params) => {
      const script = snippets.scriptSetCameraProperties(params as any);
      const res = await bridge.execute('setCameraProperties', script, `Set camera properties on ${params.cameraName || params.cameraIndex || 'Camera'}`, params);
      return formatResponse(res);
    }
  );

  // --- 10c. applyCameraMove ---
  server.tool(
    'applyCameraMove',
    'Execute cinematic camera movements ("运镜") with automatic keyframing and easing: orbit (环绕), dolly in/out (推拉), truck (横移), boom/pedestal (升降), pan (摇镜头), whip pan (甩镜头), dolly zoom (希区柯克眩晕变焦), fly through (穿梭), spiral (螺旋), handheld shake (手持呼吸感)',
    {
      compName: z.string().optional().describe('Composition name (defaults to active comp)'),
      cameraName: z.string().optional().describe('Camera layer name (defaults to first camera)'),
      cameraIndex: z.number().optional().describe('Camera layer index (1-based)'),
      moveType: z.enum([
        'orbit',
        'dolly_in',
        'dolly_out',
        'truck',
        'pedestal',
        'boom',
        'pan',
        'whip_pan',
        'dolly_zoom',
        'fly_through',
        'spiral',
        'handheld_shake'
      ]).describe('Cinematic camera move type'),
      targetLayerName: z.string().optional().describe('Target layer to orbit around, look at, or dolly toward'),
      targetLayerIndex: z.number().optional().describe('Target layer index (1-based)'),
      startTime: z.number().optional().describe('Movement start time in seconds (default: 0)'),
      duration: z.number().optional().describe('Movement duration in seconds (default: 2.5)'),
      distance: z.number().optional().describe('Distance in pixels for dolly/truck/boom movements'),
      angle: z.number().optional().describe('Angle in degrees for orbit, pan, or whip pan (e.g. 45, 90, 180, 360)'),
      direction: z.enum(['left', 'right', 'up', 'down', 'clockwise', 'counter_clockwise']).optional().describe('Direction of movement'),
      easing: z.enum(['cinematic', 'dynamicSnap', 'smooth', 'easeIn', 'easeOut', 'linear']).optional().describe('Keyframe easing curve (default: "cinematic")'),
      handheldIntensity: z.enum(['subtle', 'moderate', 'intense']).optional().describe('Handheld shake intensity level (for "handheld_shake" moveType)'),
    },
    async (params) => {
      const script = snippets.scriptApplyCameraMove(params as any);
      const res = await bridge.execute('applyCameraMove', script, `Camera move: ${params.moveType}`, params);
      return formatResponse(res);
    }
  );

  // --- 10d. createCameraRig ---
  server.tool(
    'createCameraRig',
    'Create a professional industry-standard 3D Camera Rig with Target Null, Orbit Null controller, and parented Camera for effortless orbit and gimbal-lock-free animation',
    {
      compName: z.string().optional().describe('Composition name (defaults to active comp)'),
      cameraName: z.string().optional().describe('Camera name (default: "Camera Rig Camera")'),
      rigName: z.string().optional().describe('Rig base name (default: "Camera Rig")'),
      targetPosition: z.tuple([z.number(), z.number(), z.number()]).optional().describe('3D coordinates where the camera rig target is centered [x, y, z] (defaults to comp center)'),
      distance: z.number().optional().describe('Camera standoff distance from target along Z axis (default: 1500)'),
    },
    async (params) => {
      const script = snippets.scriptCreateCameraRig(params as any);
      const res = await bridge.execute('createCameraRig', script, `Create camera rig '${params.rigName || 'Camera Rig'}'`, params);
      return formatResponse(res);
    }
  );

  // --- 10e. trackCameraToLayer ---
  server.tool(
    'trackCameraToLayer',
    'Link a 3D camera to track a target layer: look_at (lock Point of Interest), follow_position (camera follows target layer movement), or focus_distance (auto-focus keeps target in sharp focus)',
    {
      compName: z.string().optional().describe('Composition name (defaults to active comp)'),
      cameraName: z.string().optional().describe('Camera layer name'),
      cameraIndex: z.number().optional().describe('Camera layer index (1-based)'),
      targetLayerName: z.string().optional().describe('Name of the target layer to track'),
      targetLayerIndex: z.number().optional().describe('Index of the target layer to track'),
      trackMode: z.enum(['look_at', 'follow_position', 'focus_distance']).describe('Tracking mode: "look_at" aims camera at target, "follow_position" maintains camera offset as target moves, "focus_distance" locks focus distance to target'),
    },
    async (params) => {
      const script = snippets.scriptTrackCameraToLayer(params as any);
      const res = await bridge.execute('trackCameraToLayer', script, `Track camera to ${params.targetLayerName || params.targetLayerIndex || 'Target'} (${params.trackMode})`, params);
      return formatResponse(res);
    }
  );

  // --- 11. createNullObject ---
  server.tool(
    'createNullObject',
    'Create a null object layer for rigging, parenting, or animation controls',
    {
      compName: z.string().optional().describe('Composition name'),
      name: z.string().optional().describe('Null layer name (default: "Null 1")'),
      duration: z.number().optional().describe('Duration in seconds (defaults to comp duration)'),
    },
    async (params) => {
      const script = snippets.scriptCreateNullObject(params);
      const res = await bridge.execute('createNullObject', script, `Create null object '${params.name || 'Null'}'`, params);
      return formatResponse(res);
    }
  );

  // --- 12. duplicateLayer ---
  server.tool(
    'duplicateLayer',
    'Duplicate an existing layer in the composition',
    {
      compName: z.string().optional().describe('Composition name'),
      layerName: z.string().optional().describe('Layer name'),
      layerIndex: z.number().optional().describe('Layer index'),
    },
    async (params) => {
      const script = snippets.scriptDuplicateLayer(params);
      const res = await bridge.execute('duplicateLayer', script, `Duplicate layer ${params.layerName || params.layerIndex}`, params);
      return formatResponse(res);
    }
  );

  // --- 13. deleteLayer ---
  server.tool(
    'deleteLayer',
    'Delete a layer from the composition',
    {
      compName: z.string().optional().describe('Composition name'),
      layerName: z.string().optional().describe('Layer name'),
      layerIndex: z.number().optional().describe('Layer index'),
    },
    async (params) => {
      const script = snippets.scriptDeleteLayer(params);
      const res = await bridge.execute('deleteLayer', script, `Delete layer ${params.layerName || params.layerIndex}`, params);
      return formatResponse(res);
    }
  );

  // --- precomposeLayers ---
  server.tool(
    'precomposeLayers',
    'Precompose selected layers into a new nested sub-composition (precomp) with custom name',
    {
      compName: z.string().optional().describe('Parent composition name (defaults to active comp)'),
      precompName: z.string().describe('Name for the new sub-composition / precomp'),
      layerIndices: z.array(z.number()).optional().describe('List of 1-based layer indices to precompose'),
      layerNames: z.array(z.string()).optional().describe('List of layer names to precompose'),
    },
    async (params) => {
      const script = snippets.scriptPrecomposeLayers(params);
      const res = await bridge.execute('precomposeLayers', script, `Precompose layers into '${params.precompName}'`, params);
      return formatResponse(res);
    }
  );

  // --- reorderLayer ---
  server.tool(
    'reorderLayer',
    'Reorder a layer vertically in the layer stack (moveBefore, moveAfter, moveToBeginning, moveToEnd, setIndex)',
    {
      compName: z.string().optional().describe('Composition name'),
      layerName: z.string().optional().describe('Layer name to reorder'),
      layerIndex: z.number().optional().describe('Layer index to reorder'),
      operation: z.enum(['moveBefore', 'moveAfter', 'moveToBeginning', 'moveToEnd', 'setIndex']).describe('Reorder operation'),
      targetLayerName: z.string().optional().describe('Target reference layer name for moveBefore/moveAfter'),
      targetLayerIndex: z.number().optional().describe('Target reference layer index for moveBefore/moveAfter'),
      newIndex: z.number().optional().describe('Specific new 1-based layer index for setIndex operation'),
    },
    async (params) => {
      const script = snippets.scriptReorderLayer(params as any);
      const res = await bridge.execute('reorderLayer', script, `Reorder layer ${params.layerName || params.layerIndex} (${params.operation})`, params);
      return formatResponse(res);
    }
  );

  // --- 14. setLayerMask ---
  server.tool(
    'setLayerMask',
    'Create or modify layer masks (shape vertices, mode, feather, opacity, expansion, inverted)',
    {
      compName: z.string().optional().describe('Composition name'),
      layerName: z.string().optional().describe('Layer name'),
      layerIndex: z.number().optional().describe('Layer index'),
      maskName: z.string().optional().describe('Mask name (e.g. "Mask 1")'),
      maskIndex: z.number().optional().describe('Mask index (1-based)'),
      maskShape: z.object({
        vertices: z.array(z.tuple([z.number(), z.number()])),
        inTangents: z.array(z.tuple([z.number(), z.number()])).optional(),
        outTangents: z.array(z.tuple([z.number(), z.number()])).optional(),
        closed: z.boolean().optional(),
      }).optional().describe('Mask shape vertex data'),
      maskMode: z.enum(['add', 'subtract', 'intersect', 'lighten', 'darken', 'difference', 'none']).optional().describe('Mask blend mode'),
      maskFeather: z.tuple([z.number(), z.number()]).optional().describe('Mask feather [x, y] in pixels'),
      maskOpacity: z.number().optional().describe('Mask opacity (0-100)'),
      maskExpansion: z.number().optional().describe('Mask expansion in pixels'),
      inverted: z.boolean().optional().describe('Invert the mask'),
    },
    async (params) => {
      const script = snippets.scriptSetLayerMask(params as any);
      const res = await bridge.execute('setLayerMask', script, `Set mask on ${params.layerName || params.layerIndex}`, params);
      return formatResponse(res);
    }
  );

  // --- 15. getInstalledPlugins ---
  server.tool(
    'getInstalledPlugins',
    'Query installed effects, plugins, and matchNames in After Effects',
    {
      category: z.string().optional().describe('Filter by effect category (e.g. "Blur & Sharpen", "Color Correction", "Stylize", "Generate")'),
      search: z.string().optional().describe('Filter by name keyword (e.g. "glow", "blur", "noise")'),
    },
    async (params) => {
      const script = snippets.scriptGetInstalledPlugins(params);
      const res = await bridge.execute('getInstalledPlugins', script, 'Get installed plugins/effects', params);
      return formatResponse(res);
    }
  );

  // --- 16. applyEffect ---
  server.tool(
    'applyEffect',
    'Apply an effect or third-party plugin to a layer by display name or matchName',
    {
      compName: z.string().optional().describe('Composition name'),
      layerName: z.string().optional().describe('Layer name'),
      layerIndex: z.number().optional().describe('Layer index'),
      effectName: z.string().describe('Effect name or matchName (e.g. "Gaussian Blur", "ADBE Gaussian Blur 2", "Glow", "ADBE CurvesCustom", "Deep Glow", etc.)'),
      properties: z.record(z.string(), z.any()).optional().describe('Initial properties to set on the effect immediately upon adding'),
    },
    async (params) => {
      const script = snippets.scriptApplyEffect(params);
      const res = await bridge.execute('applyEffect', script, `Apply effect '${params.effectName}' to layer`, params);
      return formatResponse(res);
    }
  );

  // --- 17. setEffectProperties ---
  server.tool(
    'setEffectProperties',
    'Set parameter values or keyframes on an applied effect/plugin',
    {
      compName: z.string().optional().describe('Composition name'),
      layerName: z.string().optional().describe('Layer name'),
      layerIndex: z.number().optional().describe('Layer index'),
      effectName: z.string().optional().describe('Effect name (e.g. "Gaussian Blur")'),
      effectIndex: z.number().optional().describe('Effect index on the layer'),
      properties: z.record(z.string(), z.any()).describe('Key-value map of property names and target values (e.g. { "Blurriness": 25 } or with time: { "Blurriness": { time: 1.0, value: 25 } })'),
    },
    async (params) => {
      const script = snippets.scriptSetEffectProperties(params);
      const res = await bridge.execute('setEffectProperties', script, `Set effect properties on ${params.effectName || params.effectIndex}`, params);
      return formatResponse(res);
    }
  );

  // --- 18. getEffectProperties ---
  server.tool(
    'getEffectProperties',
    'Inspect all parameters, matchNames, types, and current values of an effect on a layer',
    {
      compName: z.string().optional().describe('Composition name'),
      layerName: z.string().optional().describe('Layer name'),
      layerIndex: z.number().optional().describe('Layer index'),
      effectName: z.string().optional().describe('Effect name'),
      effectIndex: z.number().optional().describe('Effect index on the layer'),
    },
    async (params) => {
      const script = snippets.scriptGetEffectProperties(params);
      const res = await bridge.execute('getEffectProperties', script, `Get effect properties for ${params.effectName || params.effectIndex}`, params);
      return formatResponse(res);
    }
  );

  // --- 19. removeEffect ---
  server.tool(
    'removeEffect',
    'Remove an effect from a layer',
    {
      compName: z.string().optional().describe('Composition name'),
      layerName: z.string().optional().describe('Layer name'),
      layerIndex: z.number().optional().describe('Layer index'),
      effectName: z.string().optional().describe('Effect name'),
      effectIndex: z.number().optional().describe('Effect index on the layer'),
    },
    async (params) => {
      const script = snippets.scriptRemoveEffect(params);
      const res = await bridge.execute('removeEffect', script, `Remove effect ${params.effectName || params.effectIndex}`, params);
      return formatResponse(res);
    }
  );

  // --- 20. createTextLayer ---
  server.tool(
    'createTextLayer',
    'Create a 2D or 3D text layer with comprehensive typography (font, size, fill/stroke colors, tracking, leading, justification, allCaps/smallCaps), 3D orientations, and direct effects list',
    {
      compName: z.string().optional().describe('Composition name (defaults to active composition)'),
      text: z.string().describe('Text content to display'),
      name: z.string().optional().describe('Layer name (defaults to text content)'),
      isThreeD: z.boolean().optional().describe('Enable 3D layer switch (default: false)'),
      fontSize: z.number().optional().describe('Font size in pixels (default: 50)'),
      font: z.string().optional().describe('Font PostScript name or family (e.g. "ArialMT", "MicrosoftYaHei", "PingFangSC-Regular")'),
      fillColor: z.tuple([z.number(), z.number(), z.number()]).optional().describe('RGB fill color [0-1, 0-1, 0-1] (e.g. [1, 1, 1] for white)'),
      color: z.tuple([z.number(), z.number(), z.number()]).optional().describe('Alias for fillColor [0-1, 0-1, 0-1]'),
      applyFill: z.boolean().optional().describe('Enable/disable fill color (default: true)'),
      strokeColor: z.tuple([z.number(), z.number(), z.number()]).optional().describe('RGB stroke color [0-1, 0-1, 0-1]'),
      strokeWidth: z.number().optional().describe('Stroke width in pixels (default: 1)'),
      applyStroke: z.boolean().optional().describe('Enable/disable stroke (default: false)'),
      strokeOverFill: z.boolean().optional().describe('Render stroke over fill (default: false)'),
      tracking: z.number().optional().describe('Tracking / character spacing (e.g. 50, -20)'),
      leading: z.number().optional().describe('Line spacing / leading in points'),
      justification: z.enum(['left', 'right', 'center', 'full']).optional().describe('Paragraph justification (left, right, center, full)'),
      allCaps: z.boolean().optional().describe('Force all caps formatting'),
      smallCaps: z.boolean().optional().describe('Force small caps formatting'),
      position: z.union([z.tuple([z.number(), z.number()]), z.tuple([z.number(), z.number(), z.number()])]).optional().describe('Layer position [x, y] or [x, y, z]'),
      orientation: z.tuple([z.number(), z.number(), z.number()]).optional().describe('3D orientation [x, y, z] in degrees (for 3D text)'),
      rotationX: z.number().optional().describe('3D X rotation in degrees'),
      rotationY: z.number().optional().describe('3D Y rotation in degrees'),
      rotationZ: z.number().optional().describe('3D Z rotation or 2D rotation in degrees'),
      effects: z.array(
        z.object({
          effectName: z.string().describe('Effect name or matchName to apply immediately'),
          properties: z.record(z.string(), z.any()).optional().describe('Key-value pairs of effect properties to set'),
        })
      ).optional().describe('List of effects/plugins to immediately apply onto this text layer'),
    },
    async (params) => {
      const script = snippets.scriptCreateTextLayer(params as any);
      const res = await bridge.execute('createTextLayer', script, `Create text layer '${params.text.slice(0, 20)}'`, params);
      return formatResponse(res);
    }
  );

  // --- 20b. formatTextLayer ---
  server.tool(
    'formatTextLayer',
    'Format an existing text layer: modify text content, font family/PostScript name, font size, fill/stroke colors, stroke width, tracking, leading, justification, allCaps/smallCaps',
    {
      compName: z.string().optional().describe('Composition name (defaults to active comp)'),
      layerName: z.string().optional().describe('Layer name'),
      layerIndex: z.number().optional().describe('Layer index (1-based)'),
      text: z.string().optional().describe('New text content'),
      fontSize: z.number().optional().describe('Font size in pixels'),
      font: z.string().optional().describe('Font PostScript name (e.g. "ArialMT", "MicrosoftYaHei", "PingFangSC-Regular")'),
      fillColor: z.tuple([z.number(), z.number(), z.number()]).optional().describe('RGB fill color [0-1, 0-1, 0-1]'),
      applyFill: z.boolean().optional().describe('Enable/disable fill color'),
      strokeColor: z.tuple([z.number(), z.number(), z.number()]).optional().describe('RGB stroke color [0-1, 0-1, 0-1]'),
      strokeWidth: z.number().optional().describe('Stroke width in pixels'),
      applyStroke: z.boolean().optional().describe('Enable/disable stroke'),
      strokeOverFill: z.boolean().optional().describe('Whether stroke renders over fill'),
      tracking: z.number().optional().describe('Tracking / character spacing (e.g. 50, -20)'),
      leading: z.number().optional().describe('Line spacing / leading in points'),
      justification: z.enum(['left', 'right', 'center', 'full']).optional().describe('Paragraph justification (left, right, center, full)'),
      allCaps: z.boolean().optional().describe('All caps formatting'),
      smallCaps: z.boolean().optional().describe('Small caps formatting'),
    },
    async (params) => {
      const script = snippets.scriptFormatTextLayer(params as any);
      const res = await bridge.execute('formatTextLayer', script, `Format text layer ${params.layerName || params.layerIndex || 1}`, params);
      return formatResponse(res);
    }
  );

  // --- 20c. getAvailableFonts ---
  server.tool(
    'getAvailableFonts',
    'Get list of available PostScript fonts registered in After Effects for typography styling',
    {},
    async () => {
      const script = snippets.scriptGetAvailableFonts();
      const res = await bridge.execute('getAvailableFonts', script, 'Get available AE fonts', {}, { skipAutoSave: true });
      return formatResponse(res);
    }
  );

  // --- 20d. addTextAnimator ---
  server.tool(
    'addTextAnimator',
    'Add an AE text animator with full selector and property control or predefined presets (typewriter, fade_up_chars, slide_in_chars, scale_pop_chars, tracking_expand, 3d_flip_chars with per-character 3D, wiggle_wave, glitch_decoder, or custom)',
    {
      compName: z.string().optional().describe('Composition name (defaults to active comp)'),
      layerName: z.string().optional().describe('Layer name'),
      layerIndex: z.number().optional().describe('Layer index (1-based)'),
      animatorName: z.string().optional().describe('Text animator name (default: "Animator 1")'),
      preset: z.enum([
        'typewriter',
        'fade_up_chars',
        'slide_in_chars',
        'scale_pop_chars',
        'tracking_expand',
        '3d_flip_chars',
        'wiggle_wave',
        'glitch_decoder',
        'custom'
      ]).optional().describe('Built-in text animation preset to apply'),
      startTime: z.number().optional().describe('Animation start time in seconds (default: 0)'),
      duration: z.number().optional().describe('Animation duration in seconds (default: 1.5)'),
      properties: z.object({
        position: z.union([z.tuple([z.number(), z.number()]), z.tuple([z.number(), z.number(), z.number()])]).optional().describe('Animator position offset [x, y] or [x, y, z]'),
        scale: z.union([z.tuple([z.number(), z.number()]), z.tuple([z.number(), z.number(), z.number()])]).optional().describe('Animator scale offset [x, y] or [x, y, z]'),
        rotation: z.number().optional().describe('2D rotation offset in degrees'),
        rotationX: z.number().optional().describe('3D X rotation offset in degrees (Per-character 3D)'),
        rotationY: z.number().optional().describe('3D Y rotation offset in degrees (Per-character 3D)'),
        rotationZ: z.number().optional().describe('3D Z rotation offset in degrees (Per-character 3D)'),
        opacity: z.number().optional().describe('Opacity percentage (0-100)'),
        tracking: z.number().optional().describe('Tracking offset amount'),
        blur: z.tuple([z.number(), z.number()]).optional().describe('Blur offset [x, y]'),
        fillColor: z.tuple([z.number(), z.number(), z.number()]).optional().describe('RGB fill color target [0-1, 0-1, 0-1]'),
        strokeColor: z.tuple([z.number(), z.number(), z.number()]).optional().describe('RGB stroke color target [0-1, 0-1, 0-1]'),
        strokeWidth: z.number().optional().describe('Stroke width target'),
        skew: z.number().optional().describe('Skew amount in degrees'),
        characterOffset: z.number().optional().describe('Character offset (for matrix/glitch decoding effects)'),
      }).optional().describe('Custom animator properties to apply'),
      rangeSelector: z.object({
        start: z.number().optional().describe('Range start percentage (0-100)'),
        end: z.number().optional().describe('Range end percentage (0-100)'),
        offset: z.number().optional().describe('Range offset percentage (-100 to 100)'),
        basedOn: z.enum(['characters', 'words', 'lines']).optional().describe('Unit to base selector on'),
        shape: z.enum(['square', 'ramp_up', 'ramp_down', 'triangle', 'round', 'smooth']).optional().describe('Selector shape'),
        easeHigh: z.number().optional().describe('High ease percentage (-100 to 100)'),
        easeLow: z.number().optional().describe('Low ease percentage (-100 to 100)'),
        randomizeOrder: z.boolean().optional().describe('Randomize order of character evaluation'),
        animateOverTime: z.object({
          startTime: z.number().describe('Animation keyframe start time'),
          endTime: z.number().describe('Animation keyframe end time'),
          type: z.enum(['start', 'end', 'offset']).describe('Which range parameter to keyframe from 0 to 100 or -100 to 100'),
        }).optional().describe('Automatic keyframe configuration for the range selector'),
      }).optional().describe('Range selector configuration'),
      wigglySelector: z.object({
        wigglesPerSecond: z.number().optional().describe('Frequency of wiggles per second (default: 2)'),
        correlation: z.number().optional().describe('Correlation percentage between characters (default: 50)'),
      }).optional().describe('Wiggly selector configuration'),
    },
    async (params) => {
      const script = snippets.scriptAddTextAnimator(params as any);
      const res = await bridge.execute('addTextAnimator', script, `Add text animator '${params.animatorName || params.preset || 'custom'}'`, params);
      return formatResponse(res);
    }
  );

  // --- 21. createSolidLayer ---
  server.tool(
    'createSolidLayer',
    'Create a solid color layer in the composition',
    {
      compName: z.string().optional().describe('Composition name'),
      name: z.string().optional().describe('Solid layer name (default: "Solid")'),
      color: z.tuple([z.number(), z.number(), z.number()]).describe('RGB color [0-1, 0-1, 0-1]'),
      width: z.number().optional().describe('Width in pixels (defaults to comp width)'),
      height: z.number().optional().describe('Height in pixels (defaults to comp height)'),
      duration: z.number().optional().describe('Duration in seconds (defaults to comp duration)'),
    },
    async (params) => {
      const script = snippets.scriptCreateSolidLayer(params as any);
      const res = await bridge.execute('createSolidLayer', script, `Create solid layer '${params.name || 'Solid'}'`, params);
      return formatResponse(res);
    }
  );

  // --- 22. getProjectInfo ---
  server.tool(
    'getProjectInfo',
    'Get general project information: file path, dirty status, list of all compositions and items',
    {},
    async () => {
      const script = snippets.scriptGetProjectInfo();
      const res = await bridge.execute('getProjectInfo', script, 'Get project information');
      return formatResponse(res);
    }
  );

  // --- 23. saveProject ---
  server.tool(
    'saveProject',
    'Save the current After Effects project file, or save a copy to a new file path',
    {
      saveAsPath: z.string().optional().describe('Optional file path to save as a new .aep file'),
    },
    async (params) => {
      const script = snippets.scriptSaveProject(params.saveAsPath);
      const res = await bridge.execute('saveProject', script, `Save project${params.saveAsPath ? ' as ' + params.saveAsPath : ''}`, params);
      return formatResponse(res);
    }
  );

  // --- 24. rollback ---
  server.tool(
    'rollback',
    'Rollback / undo the last mutating operation in After Effects',
    {},
    async () => {
      const res = await bridge.rollback();
      return formatResponse(res);
    }
  );

  // --- 25. getHistory ---
  server.tool(
    'getHistory',
    'Get the execution history log of all operations performed via MCP, including snapshot and rollback status',
    {
      limit: z.number().optional().describe('Number of entries to return (default: 20)'),
    },
    async (params) => {
      const entries = history.getEntries().slice(0, params.limit || 20);
      return formatResponse({
        total: entries.length,
        entries,
      });
    }
  );

  // --- 26. configureSettings ---
  server.tool(
    'configureSettings',
    'Modify MCP settings: toggle autoSave (save on every operation), autoRecordHistory, saveMode, history limit, and timeouts',
    {
      autoSave: z.boolean().optional().describe('Whether to auto-save after each operation (default: true)'),
      autoRecordHistory: z.boolean().optional().describe('Whether to record each action in history (default: true)'),
      saveMode: z.enum(['project', 'snapshot', 'both']).optional().describe('Save mode: "project" (overwrite .aep), "snapshot" (backup copy), or "both"'),
      maxHistory: z.number().optional().describe('Maximum number of history records and snapshots to keep (default: 50)'),
      timeoutMs: z.number().optional().describe('Command execution timeout in milliseconds (default: 15000)'),
      aeExecutablePath: z.string().optional().describe('Path to AfterFX.exe for CLI fallback'),
    },
    async (params) => {
      const updated = config.updateSettings(params);
      return formatResponse({
        success: true,
        message: 'Settings updated successfully.',
        currentSettings: updated,
      });
    }
  );

  // --- 27. getSettings ---
  server.tool(
    'getSettings',
    'Get current MCP settings and connection status to After Effects',
    {},
    async () => {
      const current = config.getSettings();
      const status = bridge.getBridgeStatus();
      return formatResponse({
        settings: current,
        bridgeStatus: status,
      });
    }
  );

  // --- 28. installBridge ---
  server.tool(
    'installBridge',
    'Automatically detect After Effects installations and install the mcp-bridge-auto.jsx panel script to ScriptUI Panels',
    {
      targetDir: z.string().optional().describe('Optional custom ScriptUI Panels directory path'),
    },
    async (params) => {
      const res = installBridgeScript(params.targetDir);
      return formatResponse(res);
    }
  );

  // --- 29. importAsset ---
  server.tool(
    'importAsset',
    'Import 3D models (.obj, .gltf, .glb), images (.png, .jpg, .psd), vectors/SVG (.svg, .ai), video (.mp4, .mov) or audio into AE project and optionally add as a layer in a composition',
    {
      filePath: z.string().describe('Absolute file path of the asset to import'),
      compName: z.string().optional().describe('If specified, immediately adds the imported asset as a layer into this composition'),
      sequence: z.boolean().optional().describe('Import as image sequence (default: false)'),
      convertToShape: z.boolean().optional().describe('If importing SVG or Illustrator vector, convert to native AE Shape Layer (default: false)'),
      isThreeD: z.boolean().optional().describe('Make the added layer a 3D layer (default: false)'),
      position: z.union([z.tuple([z.number(), z.number()]), z.tuple([z.number(), z.number(), z.number()])]).optional().describe('Initial position [x, y] or [x, y, z]'),
      scale: z.union([z.tuple([z.number(), z.number()]), z.tuple([z.number(), z.number(), z.number()])]).optional().describe('Initial scale [x, y] or [x, y, z]'),
      name: z.string().optional().describe('Optional custom name for footage/layer'),
    },
    async (params) => {
      const script = snippets.scriptImportAsset(params as any);
      const res = await bridge.execute('importAsset', script, `Import asset '${params.filePath}'`, params);
      return formatResponse(res);
    }
  );

  // --- 30. create3DLayer ---
  server.tool(
    'create3DLayer',
    'Create a 3D layer (solid, text, null, or shape) with 3D transforms pre-configured',
    {
      compName: z.string().optional().describe('Composition name'),
      layerType: z.enum(['solid', 'text', 'null', 'shape']).describe('3D layer type to create'),
      name: z.string().optional().describe('Layer name'),
      text: z.string().optional().describe('Text content (if layerType is "text")'),
      color: z.tuple([z.number(), z.number(), z.number()]).optional().describe('RGB color [0-1, 0-1, 0-1] (if layerType is "solid")'),
      size: z.tuple([z.number(), z.number()]).optional().describe('[width, height] dimensions (default: comp size)'),
      position: z.tuple([z.number(), z.number(), z.number()]).optional().describe('3D position [x, y, z]'),
      orientation: z.tuple([z.number(), z.number(), z.number()]).optional().describe('3D orientation [x, y, z] in degrees'),
      rotationX: z.number().optional().describe('X rotation in degrees'),
      rotationY: z.number().optional().describe('Y rotation in degrees'),
      rotationZ: z.number().optional().describe('Z rotation in degrees'),
      scale: z.tuple([z.number(), z.number(), z.number()]).optional().describe('3D scale [x, y, z] (100 = 100%)'),
    },
    async (params) => {
      const script = snippets.scriptCreate3DLayer(params);
      const res = await bridge.execute('create3DLayer', script, `Create 3D ${params.layerType} layer '${params.name || ''}'`, params);
      return formatResponse(res);
    }
  );

  // --- 31. createLight ---
  server.tool(
    'createLight',
    'Create a 3D light layer (Point, Spot, Parallel, Ambient) with intensity, color, shadows, and angle controls',
    {
      compName: z.string().optional().describe('Composition name'),
      name: z.string().optional().describe('Light name (default: "Light 1")'),
      lightType: z.enum(['POINT', 'SPOT', 'PARALLEL', 'AMBIENT']).optional().describe('Light type (default: "POINT")'),
      intensity: z.number().optional().describe('Light intensity percentage (default: 100)'),
      color: z.tuple([z.number(), z.number(), z.number()]).optional().describe('RGB color [0-1, 0-1, 0-1]'),
      coneAngle: z.number().optional().describe('Spot light cone angle in degrees (default: 90)'),
      coneFeather: z.number().optional().describe('Spot light cone feather percentage (default: 50)'),
      castsShadows: z.boolean().optional().describe('Whether light casts shadows (default: false)'),
      shadowDarkness: z.number().optional().describe('Shadow darkness percentage (0-100)'),
      shadowDiffusion: z.number().optional().describe('Shadow diffusion in pixels'),
      position: z.tuple([z.number(), z.number(), z.number()]).optional().describe('3D position [x, y, z]'),
      pointOfInterest: z.tuple([z.number(), z.number(), z.number()]).optional().describe('3D target point [x, y, z]'),
    },
    async (params) => {
      const script = snippets.scriptCreateLight(params);
      const res = await bridge.execute('createLight', script, `Create ${params.lightType || 'POINT'} light '${params.name || 'Light'}'`, params);
      return formatResponse(res);
    }
  );

  // --- 32. set3DLayerTransform ---
  server.tool(
    'set3DLayerTransform',
    'Set 3D transform properties on a layer (position, orientation, rotationX, rotationY, rotationZ, scale, anchor point)',
    {
      compName: z.string().optional().describe('Composition name'),
      layerName: z.string().optional().describe('Layer name'),
      layerIndex: z.number().optional().describe('Layer index (1-based)'),
      position: z.tuple([z.number(), z.number(), z.number()]).optional().describe('3D position [x, y, z]'),
      orientation: z.tuple([z.number(), z.number(), z.number()]).optional().describe('3D orientation [x, y, z] in degrees'),
      rotationX: z.number().optional().describe('X rotation in degrees'),
      rotationY: z.number().optional().describe('Y rotation in degrees'),
      rotationZ: z.number().optional().describe('Z rotation in degrees'),
      scale: z.tuple([z.number(), z.number(), z.number()]).optional().describe('3D scale [x, y, z] (100 = 100%)'),
      anchorPoint: z.tuple([z.number(), z.number(), z.number()]).optional().describe('3D anchor point [x, y, z]'),
    },
    async (params) => {
      const script = snippets.scriptSet3DLayerTransform(params);
      const res = await bridge.execute('set3DLayerTransform', script, `Set 3D transforms on ${params.layerName || params.layerIndex}`, params);
      return formatResponse(res);
    }
  );

  // --- 33. addLayerMask ---
  server.tool(
    'addLayerMask',
    'Add a new mask to a layer (rectangle, ellipse, polygon, or custom bezier shape) with mode, feather, and opacity',
    {
      compName: z.string().optional().describe('Composition name'),
      layerName: z.string().optional().describe('Layer name'),
      layerIndex: z.number().optional().describe('Layer index (1-based)'),
      maskName: z.string().optional().describe('Mask name (default: "Mask 1")'),
      shapeType: z.enum(['rectangle', 'ellipse', 'polygon', 'custom']).describe('Mask geometry type'),
      bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional().describe('Bounds [left, top, width, height] for rectangle or ellipse'),
      vertices: z.array(z.tuple([z.number(), z.number()])).optional().describe('List of 2D vertex coordinates [[x,y],...] for polygon/custom'),
      inTangents: z.array(z.tuple([z.number(), z.number()])).optional().describe('In-tangents for bezier control points'),
      outTangents: z.array(z.tuple([z.number(), z.number()])).optional().describe('Out-tangents for bezier control points'),
      closed: z.boolean().optional().describe('Whether mask shape is closed (default: true)'),
      maskMode: z.enum(['add', 'subtract', 'intersect', 'lighten', 'darken', 'difference', 'none']).optional().describe('Mask blending mode (default: "add")'),
      feather: z.tuple([z.number(), z.number()]).optional().describe('Mask feather [x, y] in pixels'),
      opacity: z.number().optional().describe('Mask opacity 0-100 (default: 100)'),
      expansion: z.number().optional().describe('Mask expansion / offset in pixels (default: 0)'),
      inverted: z.boolean().optional().describe('Invert mask (default: false)'),
    },
    async (params) => {
      const script = snippets.scriptAddLayerMask(params as any);
      const res = await bridge.execute('addLayerMask', script, `Add ${params.shapeType} mask to ${params.layerName || params.layerIndex}`, params);
      return formatResponse(res);
    }
  );

  // --- 34. getLayerMaterialOptions ---
  server.tool(
    'getLayerMaterialOptions',
    'Get 3D material/shader options for a 3D layer (casts shadows, light transmission, ambient, diffuse, specular, metal, etc.)',
    {
      compName: z.string().optional().describe('Composition name'),
      layerName: z.string().optional().describe('Layer name'),
      layerIndex: z.number().optional().describe('Layer index (1-based)'),
    },
    async (params) => {
      const script = snippets.scriptGetLayerMaterialOptions(params);
      const res = await bridge.execute('getLayerMaterialOptions', script, `Get material options for ${params.layerName || params.layerIndex}`, params);
      return formatResponse(res);
    }
  );

  // --- 35. setLayerMaterialOptions ---
  server.tool(
    'setLayerMaterialOptions',
    'Configure 3D material options and shaders on a 3D layer (shadows, lights, ambient, diffuse, specular, shininess, metal, roughness)',
    {
      compName: z.string().optional().describe('Composition name'),
      layerName: z.string().optional().describe('Layer name'),
      layerIndex: z.number().optional().describe('Layer index (1-based)'),
      castsShadows: z.union([z.enum(['off', 'on', 'only']), z.number()]).optional().describe('Casts shadows ("off", "on", "only")'),
      lightTransmission: z.number().optional().describe('Light transmission percentage (0-100)'),
      acceptsShadows: z.union([z.enum(['off', 'on', 'only']), z.number()]).optional().describe('Accepts shadows ("off", "on", "only")'),
      acceptsLights: z.union([z.enum(['off', 'on']), z.number()]).optional().describe('Accepts lights ("off", "on")'),
      ambient: z.number().optional().describe('Ambient reflection percentage (0-100)'),
      diffuse: z.number().optional().describe('Diffuse reflection percentage (0-100)'),
      specularIntensity: z.number().optional().describe('Specular intensity percentage (0-100)'),
      specularShininess: z.number().optional().describe('Specular shininess percentage (0-100)'),
      metal: z.number().optional().describe('Metal reflection percentage (0-100)'),
      roughness: z.number().optional().describe('Surface roughness percentage in Advanced 3D (0-100)'),
      reflectionCoefficient: z.number().optional().describe('Reflection coefficient percentage (0-100)'),
      transparency: z.number().optional().describe('Material transparency percentage (0-100)'),
      customProperties: z.record(z.string(), z.any()).optional().describe('Any custom material properties'),
    },
    async (params) => {
      const script = snippets.scriptSetLayerMaterialOptions(params);
      const res = await bridge.execute('setLayerMaterialOptions', script, `Set material options on ${params.layerName || params.layerIndex}`, params);
      return formatResponse(res);
    }
  );

  // --- 36. getCompRenderer ---
  server.tool(
    'getCompRenderer',
    'Get composition 3D render engine and shader mode (Classic 3D, Advanced 3D, Cinema 4D) and list of available renderers',
    {
      compName: z.string().optional().describe('Composition name (defaults to active comp)'),
    },
    async (params) => {
      const script = snippets.scriptGetCompRenderer(params);
      const res = await bridge.execute('getCompRenderer', script, 'Get composition 3D renderer', params);
      return formatResponse(res);
    }
  );

  // --- 37. setCompRenderer ---
  server.tool(
    'setCompRenderer',
    'Switch composition 3D render engine (e.g. "ADBE Advanced 3D" for PBR & 3D models, "ADBE Cinema 4D" for extrusions, "ADBE Classic 3D")',
    {
      compName: z.string().optional().describe('Composition name'),
      renderer: z.string().describe('Target 3D render engine: "ADBE Advanced 3D", "ADBE Cinema 4D", or "ADBE Classic 3D"'),
    },
    async (params) => {
      const script = snippets.scriptSetCompRenderer(params);
      const res = await bridge.execute('setCompRenderer', script, `Set 3D renderer to '${params.renderer}'`, params);
      return formatResponse(res);
    }
  );

  // --- 38. setKeyframeVelocity ---
  server.tool(
    'setKeyframeVelocity',
    'Adjust the speed and influence velocity curves (Graph Editor curve) of a keyframe on a property',
    {
      compName: z.string().optional().describe('Composition name'),
      layerName: z.string().optional().describe('Layer name'),
      layerIndex: z.number().optional().describe('Layer index (1-based)'),
      propertyName: z.string().describe('Property name to adjust (e.g. "Position", "Scale", "Opacity", "Rotation", or effect property)'),
      keyIndex: z.number().optional().describe('Keyframe index (1-based, defaults to 1 or matched by time)'),
      time: z.number().optional().describe('Timestamp in seconds to target nearest keyframe'),
      inSpeed: z.number().optional().describe('Incoming speed (value change/second, default: 0)'),
      inInfluence: z.number().optional().describe('Incoming influence percentage (0.1 to 100%, default: 33.33)'),
      outSpeed: z.number().optional().describe('Outgoing speed (value change/second, default: 0)'),
      outInfluence: z.number().optional().describe('Outgoing influence percentage (0.1 to 100%, default: 33.33)'),
      preset: z.enum(['easyEase', 'easeIn', 'easeOut', 'dynamicSnap', 'extremeSnap', 'linear']).optional().describe('Pre-configured velocity curve preset ("dynamicSnap" = 75% influence modern snappy curve)'),
    },
    async (params) => {
      const script = snippets.scriptSetKeyframeVelocity(params);
      const res = await bridge.execute('setKeyframeVelocity', script, `Set velocity curve on ${params.propertyName}`, params);
      return formatResponse(res);
    }
  );

  // --- 39. getKeyframeInfo ---
  server.tool(
    'getKeyframeInfo',
    'Get detailed information on all keyframes for a property including values, times, interpolation, and speed/influence curves',
    {
      compName: z.string().optional().describe('Composition name'),
      layerName: z.string().optional().describe('Layer name'),
      layerIndex: z.number().optional().describe('Layer index (1-based)'),
      propertyName: z.string().describe('Property name to inspect'),
    },
    async (params) => {
      const script = snippets.scriptGetKeyframeInfo(params);
      const res = await bridge.execute('getKeyframeInfo', script, `Get keyframe info for ${params.propertyName}`, params);
      return formatResponse(res);
    }
  );

  // --- 40. exportFrame ---
  server.tool(
    'exportFrame',
    'Export a screenshot / state image of a specific frame or current time in a composition as PNG, and return base64 preview',
    {
      compName: z.string().optional().describe('Composition name (defaults to active comp)'),
      time: z.number().optional().describe('Time in seconds to capture'),
      frame: z.number().optional().describe('Frame number to capture (0-based)'),
      outputPath: z.string().optional().describe('Custom output file path for PNG image'),
      returnBase64: z.boolean().optional().describe('Whether to return base64 data URI of the captured image (default: true)'),
    },
    async (params) => {
      const bridgeDir = config.getSettings().bridgeDir;
      const targetPath = params.outputPath || path.join(bridgeDir, 'snapshots', `frame_${Date.now()}.png`);
      const script = snippets.scriptExportFrame({
        compName: params.compName,
        time: params.time,
        frame: params.frame,
        outputPath: targetPath,
      });

      const res = await bridge.execute('exportFrame', script, 'Export frame state image', params);

      let base64Preview: string | undefined = undefined;
      if (params.returnBase64 !== false && fs.existsSync(targetPath)) {
        try {
          const imgBuffer = fs.readFileSync(targetPath);
          base64Preview = `data:image/png;base64,${imgBuffer.toString('base64')}`;
        } catch {
          // ignore
        }
      }

      return formatResponse({
        success: true,
        filePath: targetPath,
        time: res.data?.time,
        frame: res.data?.frame,
        dimensions: [res.data?.width, res.data?.height],
        base64Image: base64Preview,
      });
    }
  );

  // --- 41. exportPreviewVideo ---
  server.tool(
    'exportPreviewVideo',
    'Quickly export a preview video for a specific frame range (e.g. frame A to frame B) with fast low-resolution rendering',
    {
      compName: z.string().optional().describe('Composition name'),
      startFrame: z.number().optional().describe('Start frame number (default: 0)'),
      endFrame: z.number().optional().describe('End frame number (default: 30)'),
      startTime: z.number().optional().describe('Start time in seconds (alternative to startFrame)'),
      endTime: z.number().optional().describe('End time in seconds (alternative to endFrame)'),
      quality: z.enum(['low', 'draft', 'medium', 'high']).optional().describe('Rendering quality level (default: "low")'),
      resolution: z.enum(['quarter', 'half', 'full']).optional().describe('Render resolution scale (default: "quarter" for ultra-fast export)'),
      outputPath: z.string().optional().describe('Target output video file path (.mp4 / .mov / .avi)'),
    },
    async (params) => {
      const bridgeDir = config.getSettings().bridgeDir;
      const previewsDir = path.join(bridgeDir, 'previews');
      if (!fs.existsSync(previewsDir)) fs.mkdirSync(previewsDir, { recursive: true });

      const targetPath = params.outputPath || path.join(previewsDir, `preview_${Date.now()}.mp4`);
      const script = snippets.scriptExportPreviewVideo({
        compName: params.compName,
        startFrame: params.startFrame,
        endFrame: params.endFrame,
        startTime: params.startTime,
        endTime: params.endTime,
        quality: params.quality || 'low',
        resolution: params.resolution || 'quarter',
        outputPath: targetPath,
      });

      const res = await bridge.execute('exportPreviewVideo', script, 'Export preview video', params, { timeoutMs: 60000 });
      return formatResponse(res);
    }
  );

  // --- exportWithAME ---
  server.tool(
    'exportWithAME',
    'Send composition to Adobe Media Encoder (AME) render queue for high-quality background rendering and encoding',
    {
      compName: z.string().optional().describe('Composition name to export (defaults to active comp)'),
      outputPath: z.string().optional().describe('Target output video file path (.mp4 / .mov / .prores)'),
      renderImmediately: z.boolean().optional().describe('Whether to start rendering in AME immediately (default: false)'),
    },
    async (params) => {
      const script = snippets.scriptExportWithAME(params);
      const res = await bridge.execute('exportWithAME', script, `Queue composition in Adobe Media Encoder`, params);
      return formatResponse(res);
    }
  );

  // --- 42. setEffectPropertyKeyframe ---
  server.tool(
    'setEffectPropertyKeyframe',
    'Animate an effect parameter by adding a keyframe at a specific time with easing curve interpolation',
    {
      compName: z.string().optional().describe('Composition name'),
      layerName: z.string().optional().describe('Layer name'),
      layerIndex: z.number().optional().describe('Layer index (1-based)'),
      effectName: z.string().optional().describe('Effect name (e.g. "Gaussian Blur", "Glow")'),
      effectIndex: z.number().optional().describe('Effect index on the layer'),
      propertyName: z.string().describe('Parameter name on the effect (e.g. "Blurriness", "Glow Radius", "Threshold")'),
      time: z.number().describe('Timestamp in seconds to set keyframe'),
      value: z.any().describe('Target value for the parameter at this keyframe'),
      keyframeInterpolation: z.enum(['linear', 'ease', 'easeIn', 'easeOut', 'hold']).optional().describe('Easing interpolation type (default: "ease")'),
    },
    async (params) => {
      const script = snippets.scriptSetEffectPropertyKeyframe(params);
      const res = await bridge.execute('setEffectPropertyKeyframe', script, `Set keyframe on effect '${params.effectName || params.effectIndex}' -> ${params.propertyName}`, params);
      return formatResponse(res);
    }
  );

  // --- 43. setEffectEnabled ---
  server.tool(
    'setEffectEnabled',
    'Enable or disable (bypass) an effect on a layer',
    {
      compName: z.string().optional().describe('Composition name'),
      layerName: z.string().optional().describe('Layer name'),
      layerIndex: z.number().optional().describe('Layer index (1-based)'),
      effectName: z.string().optional().describe('Effect name'),
      effectIndex: z.number().optional().describe('Effect index on layer'),
      enabled: z.boolean().describe('True to enable effect, false to disable/bypass'),
    },
    async (params) => {
      const script = snippets.scriptSetEffectEnabled(params);
      const res = await bridge.execute('setEffectEnabled', script, `Set effect enabled state to ${params.enabled}`, params);
      return formatResponse(res);
    }
  );

  // --- 44. reorderEffect ---
  server.tool(
    'reorderEffect',
    'Reorder an effect in the layer effect stack (move up or down)',
    {
      compName: z.string().optional().describe('Composition name'),
      layerName: z.string().optional().describe('Layer name'),
      layerIndex: z.number().optional().describe('Layer index (1-based)'),
      effectName: z.string().optional().describe('Effect name to move'),
      effectIndex: z.number().optional().describe('Effect index to move'),
      newIndex: z.number().describe('Target index in the effect stack (1-based)'),
    },
    async (params) => {
      const script = snippets.scriptReorderEffect(params);
      const res = await bridge.execute('reorderEffect', script, `Move effect to index ${params.newIndex}`, params);
      return formatResponse(res);
    }
  );

  // --- 48. aiModifySelectedLayer ---
  server.tool(
    'aiModifySelectedLayer',
    'Instruct AI to modify a specific layer in After Effects using natural language prompt (transforms, keyframes, effects, masks, expressions) with optional visual screenshot input',
    {
      prompt: z.string().describe('Natural language prompt describing how to modify the layer (e.g. "做个平滑淡入加弹跳落入动效", "加赛博朋克发光并随时间呼吸闪烁")'),
      compName: z.string().optional().describe('Composition name (defaults to active comp)'),
      layerName: z.string().optional().describe('Layer name (defaults to active/first layer)'),
      layerIndex: z.number().optional().describe('Layer index (1-based)'),
      attachScreenshot: z.boolean().optional().describe('Whether to capture and send current frame screenshot to AI (default: true)'),
    },
    async (params) => {
      // 1. Fetch current layer info
      const infoScript = snippets.scriptGetLayerInfo({
        compName: params.compName,
        layerName: params.layerName,
        layerIndex: params.layerIndex,
      });
      const infoRes = await bridge.execute('getLayerInfo', infoScript, 'Fetch layer info for AI', params, { skipAutoSave: true });
      const layerData = infoRes.data?.layer || infoRes.data?.layers?.[0];

      // 2. Optionally capture frame screenshot
      let screenshotPath: string | undefined = undefined;
      const cfg = aiService.getConfig();
      if ((params.attachScreenshot !== false) && cfg.enableImages) {
        try {
          const snapFile = path.join(cfg.baseUrl ? config.getSettings().bridgeDir : '', 'snapshots', `ai_frame_${Date.now()}.png`);
          const snapScript = snippets.scriptExportFrame({
            compName: params.compName,
            outputPath: snapFile,
          });
          const snapRes = await bridge.execute('exportFrame', snapScript, 'Capture frame for AI', params, { skipAutoSave: true });
          if (snapRes.success && fs.existsSync(snapFile)) {
            screenshotPath = snapFile;
          }
        } catch {
          // ignore screenshot failure
        }
      }

      // 3. Request AI to generate ExtendScript
      const aiResult = await aiService.modifyLayerWithAI({
        prompt: params.prompt,
        layerInfo: layerData,
        imagePath: screenshotPath,
      });

      // 4. Execute the generated ExtendScript on the target layer in AE
      const layerRef = params.layerIndex !== undefined ? params.layerIndex : (params.layerName || 1);
      const executionScript = `(function() {
        ${snippets.ExtendScriptHelpers}
        var comp = __findComp(${JSON.stringify(params.compName)});
        var layer = __findLayer(comp, ${JSON.stringify(layerRef)});
        ${aiResult.script}
        return {
          modifiedLayer: layer.name,
          layerIndex: layer.index
        };
      })()`;

      const execRes = await bridge.execute(
        'aiModifySelectedLayer',
        executionScript,
        `AI: ${params.prompt.slice(0, 40)}`,
        params
      );

      return formatResponse({
        success: true,
        prompt: params.prompt,
        layer: layerData?.name,
        aiExplanation: aiResult.explanation,
        generatedScript: aiResult.script,
        executionResult: execRes.data,
        autoSaved: execRes.autoSaved,
      });
    }
  );
}



