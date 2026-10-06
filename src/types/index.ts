export interface MCPSettings {
  autoSave: boolean;
  autoRecordHistory: boolean;
  saveMode: 'project' | 'snapshot' | 'both';
  maxHistory: number;
  timeoutMs: number;
  aeExecutablePath?: string;
  bridgeDir: string;
}

export interface HistoryEntry {
  id: string;
  timestamp: string;
  action: string;
  description: string;
  params?: any;
  snapshotFile?: string;
  success: boolean;
  rolledBack?: boolean;
}

export interface BridgeCommand {
  id: string;
  action: string;
  timestamp: number;
  script: string;
  autoSave?: boolean;
  saveMode?: 'project' | 'snapshot' | 'both';
  undoGroupName?: string;
  snapshotPath?: string;
}

export interface BridgeResult {
  id: string;
  timestamp: number;
  success: boolean;
  data?: any;
  error?: string;
  saved?: boolean;
  savedPath?: string;
  snapshotPath?: string;
}

export interface HeartbeatInfo {
  timestamp: number;
  aeVersion?: string;
  activeProject?: string;
  autoRunEnabled?: boolean;
}

export interface AIConfig {
  apiKey: string;
  provider: 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'ollama' | 'custom';
  baseUrl: string;
  model: string;
  thinkingLevel: 'off' | 'low' | 'medium' | 'high';
  enableImages: boolean;
  enableVideos: boolean;
  autoSaveAfterAI: boolean;
  availableModels: string[];
}

export interface AIRequest {
  id: string;
  type: 'modify_layer' | 'fetch_models';
  timestamp: number;
  prompt?: string;
  layerInfo?: any;
  compInfo?: any;
  imagePath?: string;
  configOverride?: Partial<AIConfig>;
}

export interface AIResponse {
  id: string;
  timestamp: number;
  success: boolean;
  type: 'modify_layer' | 'fetch_models';
  script?: string;
  explanation?: string;
  models?: string[];
  error?: string;
}

