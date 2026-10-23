import fs from 'fs';
import path from 'path';
import { AIConfig, AIRequest, AIResponse } from '../types/index.js';
import { ConfigManager } from '../config/index.js';
import { analyzeAudioRhythm } from '../audio/beat-analyzer.js';
import { alignLyricsWithMMS } from '../audio/mms-aligner.js';
import { evaluateVideoWithDOVER } from '../video/dover-scorer.js';

const DEFAULT_AI_CONFIG: AIConfig = {
  apiKey: '',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  thinkingLevel: 'off',
  enableImages: true,
  enableVideos: false,
  autoSaveAfterAI: true,
  availableModels: [
    'gpt-4o',
    'gpt-4o-mini',
    'o3-mini',
    'claude-3-7-sonnet',
    'claude-3-5-sonnet',
    'gemini-2.0-flash',
    'deepseek-chat',
    'deepseek-reasoner',
  ],
};

export class AIService {
  private static instance: AIService;
  private configFilePath: string;
  private requestFilePath: string;
  private responseFilePath: string;
  private config: AIConfig;
  private isProcessingQueue = false;

  private constructor() {
    const bridgeDir = ConfigManager.getInstance().getSettings().bridgeDir;
    this.configFilePath = path.join(bridgeDir, 'ai_config.json');
    this.requestFilePath = path.join(bridgeDir, 'ai_requests.json');
    this.responseFilePath = path.join(bridgeDir, 'ai_responses.json');
    this.config = this.loadConfig();
    this.startQueueWatcher();
  }

  public static getInstance(): AIService {
    if (!AIService.instance) {
      AIService.instance = new AIService();
    }
    return AIService.instance;
  }

  private loadConfig(): AIConfig {
    if (fs.existsSync(this.configFilePath)) {
      try {
        const raw = fs.readFileSync(this.configFilePath, 'utf-8');
        return { ...DEFAULT_AI_CONFIG, ...JSON.parse(raw) };
      } catch {
        // ignore
      }
    }
    return { ...DEFAULT_AI_CONFIG };
  }

  public getConfig(): AIConfig {
    return { ...this.config };
  }

  public updateConfig(partial: Partial<AIConfig>): AIConfig {
    this.config = { ...this.config, ...partial };
    try {
      fs.writeFileSync(this.configFilePath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save ai_config.json', err);
    }
    return this.getConfig();
  }

  public async fetchModels(override?: Partial<AIConfig>): Promise<string[]> {
    const cfg = { ...this.config, ...override };
    let endpoint = cfg.baseUrl.replace(/\/+$/, '') + '/models';

    if (cfg.provider === 'ollama') {
      endpoint = cfg.baseUrl.replace(/\/+$/, '') + '/api/tags';
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (cfg.apiKey) {
      headers['Authorization'] = `Bearer ${cfg.apiKey}`;
    }

    try {
      const resp = await fetch(endpoint, { method: 'GET', headers });
      if (!resp.ok) {
        throw new Error(`HTTP error ${resp.status}: ${await resp.text()}`);
      }
      const data = await resp.json() as any;
      let models: string[] = [];

      if (Array.isArray(data?.data)) {
        models = data.data.map((m: any) => m.id).filter(Boolean);
      } else if (Array.isArray(data?.models)) {
        models = data.models.map((m: any) => m.name || m.id).filter(Boolean);
      }

      if (models.length === 0) {
        models = cfg.availableModels;
      } else {
        models.sort();
      }

      this.updateConfig({ availableModels: models });
      return models;
    } catch (err: any) {
      throw new Error(`Failed to fetch models: ${err.message}`);
    }
  }

  public async modifyLayerWithAI(params: {
    prompt: string;
    layerInfo: any;
    imagePath?: string;
    configOverride?: Partial<AIConfig>;
  }): Promise<{ script: string; explanation: string }> {
    const cfg = { ...this.config, ...params.configOverride };
    if (!cfg.apiKey && cfg.provider !== 'ollama') {
      throw new Error('API Key is missing. Please configure your API key in AI settings.');
    }

    let endpoint = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';

    const systemPrompt = `You are an expert Adobe After Effects ExtendScript developer.
The user wants to modify a selected layer in After Effects according to their creative instruction.

Target layer context:
${JSON.stringify(params.layerInfo, null, 2)}

Instructions:
1. Write robust, executable ExtendScript JavaScript code to modify the target layer.
2. Assume the variable 'layer' represents the target layer, and 'comp' represents the active composition.
3. You can set transform properties (position, scale, rotation, opacity, 3D), add keyframes with velocity curves, set expressions, add effects (ADBE Effect Parade), configure effect parameters, add masks, etc.
4. Output your response in two parts:
- First, a concise explanation in natural language describing what modifications were made.
- Second, the exact ExtendScript JavaScript code enclosed in a \`\`\`javascript ... \`\`\` code fence.`;

    const userContent: any[] = [];
    userContent.push({
      type: 'text',
      text: `User Request: "${params.prompt}"\nModify the selected layer to achieve this effect.`,
    });

    if (cfg.enableImages && params.imagePath && fs.existsSync(params.imagePath)) {
      try {
        const imgBuffer = fs.readFileSync(params.imagePath);
        const base64 = imgBuffer.toString('base64');
        userContent.push({
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${base64}`,
          },
        });
      } catch {
        // ignore image error
      }
    }

    const requestBody: any = {
      model: cfg.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.4,
    };

    if (cfg.thinkingLevel && cfg.thinkingLevel !== 'off') {
      if (cfg.model.includes('o1') || cfg.model.includes('o3') || cfg.model.includes('deepseek-reasoner')) {
        requestBody.reasoning_effort = cfg.thinkingLevel;
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (cfg.apiKey) {
      headers['Authorization'] = `Bearer ${cfg.apiKey}`;
    }

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`AI API error ${resp.status}: ${errText}`);
    }

    const data = await resp.json() as any;
    const fullText: string = data.choices?.[0]?.message?.content || '';

    // Extract code block
    let script = '';
    let explanation = fullText;
    const codeMatch = fullText.match(/```(?:javascript|js|extendscript)?\s*([\s\S]*?)```/i);

    if (codeMatch && codeMatch[1]) {
      script = codeMatch[1].trim();
      explanation = fullText.replace(codeMatch[0], '').trim();
    } else {
      script = fullText.trim();
    }

    return {
      script,
      explanation: explanation || 'Applied layer modifications based on prompt.',
    };
  }

  // --- Background Queue for In-AE Panel Requests ---
  private startQueueWatcher(): void {
    setInterval(() => {
      this.checkAndProcessQueue();
    }, 400);
  }

  private async checkAndProcessQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    if (!fs.existsSync(this.requestFilePath)) return;

    let req: AIRequest | null = null;
    try {
      const raw = fs.readFileSync(this.requestFilePath, 'utf-8');
      if (!raw.trim()) return;
      req = JSON.parse(raw);
    } catch {
      return;
    }

    if (!req || !req.id) return;

    // Check if response already exists for this id
    if (fs.existsSync(this.responseFilePath)) {
      try {
        const lastResp: AIResponse = JSON.parse(fs.readFileSync(this.responseFilePath, 'utf-8'));
        if (lastResp && lastResp.id === req.id) {
          return;
        }
      } catch {}
    }

    this.isProcessingQueue = true;

    const response: AIResponse = {
      id: req.id,
      timestamp: Date.now(),
      type: req.type,
      success: false,
    };

    try {
      if (req.type === 'fetch_models') {
        const models = await this.fetchModels(req.configOverride);
        response.success = true;
        response.models = models;
      } else if (req.type === 'modify_layer') {
        const result = await this.modifyLayerWithAI({
          prompt: req.prompt || '',
          layerInfo: req.layerInfo || {},
          imagePath: req.imagePath,
          configOverride: req.configOverride,
        });
        response.success = true;
        response.script = result.script;
        response.explanation = result.explanation;
      } else if (req.type === 'analyze_audio_beats') {
        if (!req.audioPath) throw new Error('Audio path is required.');
        const analysis = analyzeAudioRhythm(req.audioPath);
        const markers: { time: number; comment: string; label: number }[] = [];
        for (const b of analysis.beats) {
          if (b.isDownbeat) {
            markers.push({
              time: b.time,
              comment: `BAR ${b.barIndex} [DOWNBEAT - ${analysis.bpm} BPM]`,
              label: 1,
            });
          }
        }
        for (const imp of analysis.drumOnsets.majorImpacts) {
          if (!markers.some((m) => Math.abs(m.time - imp.time) < 0.045)) {
            markers.push({
              time: imp.time,
              comment: `DRUM IMPACT (${imp.strength})`,
              label: 2,
            });
          }
        }
        markers.sort((a, b) => a.time - b.time);

        const markerScript = `
          var items = ${JSON.stringify(markers)};
          for (var i = 0; i < items.length; i++) {
            var mv = new MarkerValue(items[i].comment);
            try { mv.label = items[i].label; } catch(e){}
            comp.markerProperty.setValueAtTime(items[i].time, mv);
          }
        `;
        response.success = true;
        response.script = markerScript;
        response.data = {
          bpm: analysis.bpm,
          bpmConfidence: analysis.bpmConfidence,
          counts: analysis.counts,
          sections: analysis.sections,
          markersCount: markers.length,
        };
        response.explanation = `BPM: ${analysis.bpm} (置信度: ${analysis.bpmConfidence}) | 总拍数: ${analysis.counts.totalBeats} | 小节重拍: ${analysis.counts.totalBars} | Kick底鼓: ${analysis.counts.kickCount} | Snare军鼓: ${analysis.counts.snareCount} | 强冲击点: ${analysis.counts.majorImpactCount}`;
      } else if (req.type === 'align_lyrics_mms') {
        if (!req.audioPath) throw new Error('Audio path is required.');
        const alignment = await alignLyricsWithMMS(req.audioPath, {
          lrcFilePath: req.lrcPath,
          lyricsText: req.prompt,
          snapWordsToBeats: true,
        });
        const items: { name: string; text: string; inPoint: number; outPoint: number }[] = [];
        const gran = req.granularity || 'line';
        if (gran === 'word') {
          for (const line of alignment.lines) {
            for (let wIdx = 0; wIdx < line.words.length; wIdx++) {
              const w = line.words[wIdx];
              items.push({
                name: `MMS_WORD_${line.lineIndex}_${wIdx + 1}_${w.word}`,
                text: w.word,
                inPoint: w.startTime,
                outPoint: w.endTime,
              });
            }
          }
        } else {
          for (const line of alignment.lines) {
            items.push({
              name: `MMS_LYRIC_${line.lineIndex}_${line.text.substring(0, 18)}`,
              text: line.text,
              inPoint: line.startTime,
              outPoint: line.endTime,
            });
          }
        }
        const genScript = `
          var items = ${JSON.stringify(items)};
          for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var lyr = comp.layers.addText(it.text);
            lyr.name = it.name;
            lyr.inPoint = it.inPoint;
            lyr.outPoint = Math.max(it.inPoint + 0.08, it.outPoint);
            lyr.threeDLayer = true;
            var srcTxtProp = lyr.property("ADBE Text Properties").property("ADBE Text Document");
            var td = srcTxtProp.value;
            td.fontSize = 86;
            td.fillColor = [1, 1, 1];
            td.justification = ParagraphJustification.CENTER_JUSTIFY;
            srcTxtProp.setValue(td);
            var rect = lyr.sourceRectAtTime(it.inPoint + 0.02, false);
            var xform = lyr.property("ADBE Transform Group");
            xform.property("ADBE Anchor Point").setValue([rect.left + rect.width / 2, rect.top + rect.height / 2, 0]);
            xform.property("ADBE Position").setValue([comp.width / 2, comp.height / 2, 0]);
            var scaleProp = xform.property("ADBE Scale");
            scaleProp.setValueAtTime(it.inPoint, [30, 30, 30]);
            scaleProp.setValueAtTime(Math.min(lyr.outPoint - 0.01, it.inPoint + 0.11), [115, 115, 115]);
            scaleProp.setValueAtTime(Math.min(lyr.outPoint, it.inPoint + 0.18), [100, 100, 100]);
          }
        `;
        response.success = true;
        response.script = genScript;
        response.data = alignment;
        response.explanation = `MMS-Align / CTC-Segmentation 对齐完成！共对齐 ${alignment.totalLines} 行 (${alignment.totalWords} 个词)，平均置信度 ${alignment.averageConfidence}，已生成 ${items.length} 个精准卡点3D字幕层。`;
      } else if (req.type === 'evaluate_video_dover') {
        if (!req.videoPath) throw new Error('Video path is required.');
        const scoreRes = await evaluateVideoWithDOVER(req.videoPath, {
          audioPath: req.audioPath,
        });
        response.success = true;
        response.data = scoreRes;
        response.explanation =
          `[DOVER-Mobile 评分报告] 综合总分: ${scoreRes.scores.overallScore}/100 (等级 ${scoreRes.scores.qualityGrade}) | ` +
          `技术质量(TQE): ${scoreRes.scores.technicalScore}/100 | 美学质量(AQE): ${scoreRes.scores.aestheticScore}/100` +
          (scoreRes.scores.audioVisualSyncScore !== undefined
            ? ` | 音画卡点同步分: ${scoreRes.scores.audioVisualSyncScore}/100`
            : '') +
          `\n建议: ${scoreRes.recommendations.join(' ')}`;
      }
    } catch (err: any) {
      response.success = false;
      response.error = err.message || err.toString();
    }

    try {
      fs.writeFileSync(this.responseFilePath, JSON.stringify(response, null, 2), 'utf-8');
      // Clear request file
      fs.writeFileSync(this.requestFilePath, '', 'utf-8');
    } catch (writeErr) {
      console.error('Failed to write ai_responses.json', writeErr);
    }

    this.isProcessingQueue = false;
  }
}
