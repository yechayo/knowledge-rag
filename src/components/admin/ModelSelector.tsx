"use client";

import { useState, useEffect, useRef } from "react";

export interface ModelConfig {
  modelName: string;
  baseURL: string;
  apiKey: string;
}

export interface SavedConfig extends ModelConfig {
  id: string;
  name: string;
  isActive: boolean;
}

const STORAGE_KEY = "agent_model_configs";
const ACTIVE_KEY = "agent_active_config";

const PRESET_MODELS = [
  {
    name: "GLM (默认)",
    modelName: "glm-4-flash",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
  },
  {
    name: "DeepSeek",
    modelName: "deepseek-chat",
    baseURL: "https://api.deepseek.com/v1",
  },
  {
    name: "SiliconFlow",
    modelName: "",
    baseURL: "https://api.siliconflow.cn/v1",
  },
  {
    name: "OpenRouter",
    modelName: "",
    baseURL: "https://openrouter.ai/api/v1",
  },
];

interface ModelSelectorProps {
  onModelChange: (config: ModelConfig | null) => void;
  disabled?: boolean;
}

export default function ModelSelector({ onModelChange, disabled }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([]);
  const [editingConfig, setEditingConfig] = useState<SavedConfig | null>(null);
  const [presetIndex, setPresetIndex] = useState(0);

  // 表单字段
  const [configName, setConfigName] = useState("");
  const [modelName, setModelName] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [apiKey, setApiKey] = useState("");

  const panelRef = useRef<HTMLDivElement>(null);

  // 加载保存的配置
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setSavedConfigs(JSON.parse(saved));
      } catch {}
    }
    const active = localStorage.getItem(ACTIVE_KEY);
    if (active) {
      try {
        const parsed = JSON.parse(active);
        setModelName(parsed.modelName || "");
        setBaseURL(parsed.baseURL || "");
        setApiKey(parsed.apiKey || "");
        setConfigName(parsed.name || "");
        if (parsed.presetIndex !== undefined) {
          setPresetIndex(parsed.presetIndex);
          setShowCustom(false);
        } else {
          setShowCustom(true);
        }
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  const saveToActive = (config: ModelConfig, name: string, isCustom: boolean, idx?: number) => {
    localStorage.setItem(ACTIVE_KEY, JSON.stringify({ ...config, name, isCustom, presetIndex: idx }));
    onModelChange(config);
    setIsOpen(false);
  };

  const handlePresetSelect = (idx: number) => {
    setPresetIndex(idx);
    setShowCustom(false);
    const preset = PRESET_MODELS[idx];
    setModelName(preset.modelName);
    setBaseURL(preset.baseURL);
    if (apiKey) {
      saveToActive({ modelName: preset.modelName, baseURL: preset.baseURL, apiKey }, preset.name, false, idx);
    }
  };

  const handleSaveCustom = () => {
    if (!configName.trim() || !apiKey || !baseURL || !modelName) return;
    const config: ModelConfig = { modelName, baseURL, apiKey };
    const name = configName.trim();

    // 如果是编辑现有配置
    if (editingConfig) {
      const updated = savedConfigs.map((c) =>
        c.id === editingConfig.id ? { ...config, id: editingConfig.id, name, isActive: true } : c
      );
      setSavedConfigs(updated);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      localStorage.setItem(ACTIVE_KEY, JSON.stringify({ ...config, name, isCustom: true }));
      onModelChange(config);
      setEditingConfig(null);
    } else {
      const newConfig: SavedConfig = { ...config, id: Date.now().toString(), name, isActive: true };
      const updated = [...savedConfigs.filter((c) => c.name !== name), newConfig];
      setSavedConfigs(updated);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      localStorage.setItem(ACTIVE_KEY, JSON.stringify({ ...config, name, isCustom: true }));
      onModelChange(config);
    }
    setConfigName("");
    setIsOpen(false);
  };

  const handleSelectSaved = (config: SavedConfig) => {
    setModelName(config.modelName);
    setBaseURL(config.baseURL);
    setApiKey(config.apiKey);
    setShowCustom(true);
    setEditingConfig(config);
    setConfigName(config.name);
    saveToActive(config, config.name, true);
  };

  const handleDeleteSaved = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedConfigs.filter((c) => c.id !== id);
    setSavedConfigs(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  const getCurrentDisplayName = () => {
    if (showCustom && configName) return configName;
    if (showCustom) return modelName || "自定义";
    return PRESET_MODELS[presetIndex]?.name || "选择模型";
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => !disabled && setIsOpen((v) => !v)}
        disabled={disabled}
        className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-[var(--text-3)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-1)] disabled:opacity-50"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <span>{getCurrentDisplayName()}</span>
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 shadow-lg max-h-[80vh] overflow-y-auto">
          {/* API Key */}
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-[var(--text-3)]">
              API Key <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="输入 API Key"
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs text-[var(--text-1)] placeholder-[var(--text-3)] outline-none focus:border-[var(--accent)]"
            />
          </div>

          {/* 已保存的配置 */}
          {savedConfigs.length > 0 && (
            <div className="mb-3">
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">已保存</label>
              <div className="space-y-1">
                {savedConfigs.map((cfg) => (
                  <div
                    key={cfg.id}
                    onClick={() => handleSelectSaved(cfg)}
                    className="group flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs cursor-pointer hover:bg-[var(--card-hover)]"
                  >
                    <div>
                      <div className="text-[var(--text-1)]">{cfg.name}</div>
                      <div className="text-[10px] text-[var(--text-3)]">{cfg.modelName}</div>
                    </div>
                    <button
                      onClick={(e) => handleDeleteSaved(cfg.id, e)}
                      className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-500 px-1"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 预设模型 */}
          <div className="mb-3">
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">预设模型</label>
            <div className="space-y-1">
              {PRESET_MODELS.map((preset, idx) => (
                <button
                  key={preset.name}
                  onClick={() => handlePresetSelect(idx)}
                  className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                    !showCustom && presetIndex === idx
                      ? "bg-[var(--accent-bg)] text-[var(--accent)]"
                      : "text-[var(--text-1)] hover:bg-[var(--card-hover)]"
                  }`}
                >
                  <span>{preset.name}</span>
                  <span className="text-[10px] text-[var(--text-3)]">
                    {preset.modelName || preset.baseURL.split("/")[2]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 自定义 */}
          <div>
            <button
              onClick={() => {
                setShowCustom((v) => !v);
                setEditingConfig(null);
                if (!showCustom) {
                  setConfigName("");
                  setModelName(PRESET_MODELS[presetIndex]?.modelName || "");
                  setBaseURL(PRESET_MODELS[presetIndex]?.baseURL || "");
                }
              }}
              className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs text-[var(--text-1)] transition-colors hover:bg-[var(--card-hover)]"
            >
              <span>{editingConfig ? "编辑配置" : "自定义模型"}</span>
              <svg
                className={`h-3 w-3 transition-transform ${showCustom ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showCustom && (
              <div className="mt-2 space-y-2 border-t border-[var(--border)] pt-2">
                <div>
                  <label className="mb-1 block text-[10px] text-[var(--text-3)]">配置名称</label>
                  <input
                    type="text"
                    value={configName}
                    onChange={(e) => setConfigName(e.target.value)}
                    placeholder="如: 我的 Claude"
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs text-[var(--text-1)] placeholder-[var(--text-3)] outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] text-[var(--text-3)]">模型名称</label>
                  <input
                    type="text"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    placeholder="如: gpt-4o, claaude-sonnet-4-6"
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs text-[var(--text-1)] placeholder-[var(--text-3)] outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] text-[var(--text-3)]">API URL</label>
                  <input
                    type="text"
                    value={baseURL}
                    onChange={(e) => setBaseURL(e.target.value)}
                    placeholder="如: https://api.openai.com/v1"
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs text-[var(--text-1)] placeholder-[var(--text-3)] outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveCustom}
                    disabled={!configName.trim() || !apiKey || !baseURL || !modelName}
                    className="flex-1 rounded-md bg-[var(--accent)] py-1.5 text-xs text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {editingConfig ? "更新配置" : "保存并使用"}
                  </button>
                  <button
                    onClick={() => {
                      if (apiKey && baseURL && modelName) {
                        saveToActive({ modelName, baseURL, apiKey }, configName || modelName, true);
                      }
                    }}
                    disabled={!apiKey || !baseURL || !modelName}
                    className="flex-1 rounded-md border border-[var(--border)] py-1.5 text-xs text-[var(--text-1)] hover:bg-[var(--card-hover)] transition-colors disabled:opacity-50"
                  >
                    仅使用
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 当前配置预览 */}
          {apiKey && baseURL && modelName && (
            <div className="mt-2 rounded-md bg-[var(--bg)] p-2 text-[10px] text-[var(--text-3)]">
              <div className="font-medium text-[var(--text-2)]">{modelName}</div>
              <div className="truncate">{baseURL}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
