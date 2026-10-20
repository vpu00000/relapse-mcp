import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type SemanticProvider = "openai" | "ollama";

export interface SemanticSettings {
  enabled: boolean;
  provider: SemanticProvider;
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  saveEmbeddingsToDisk: boolean;
}

export const SEMANTIC_CONFIG_DIR = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "relapse-mcp"
);
export const SEMANTIC_SETTINGS_PATH = path.join(SEMANTIC_CONFIG_DIR, "semantic-search.json");

export const DEFAULT_SEMANTIC_SETTINGS: SemanticSettings = {
  enabled: true,
  provider: "openai",
  openaiApiKey: "",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "text-embedding-3-small",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "embeddinggemma",
  saveEmbeddingsToDisk: false,
};

function withEnvironment(settings: SemanticSettings): SemanticSettings {
  const environment = process.env;
  return {
    ...settings,
    provider: normalizeProvider(environment.RELAPSE_MCP_EMBEDDING_PROVIDER, settings.provider),
    openaiApiKey: environment.RELAPSE_MCP_OPENAI_API_KEY || environment.OPENAI_API_KEY || settings.openaiApiKey,
    openaiBaseUrl: normalizeOpenAIBaseUrl(environment.RELAPSE_MCP_OPENAI_BASE_URL, settings.openaiBaseUrl),
    openaiModel: environment.RELAPSE_MCP_OPENAI_MODEL || settings.openaiModel,
    ollamaBaseUrl: normalizeOllamaBaseUrl(environment.RELAPSE_MCP_OLLAMA_BASE_URL, settings.ollamaBaseUrl),
    ollamaModel: environment.RELAPSE_MCP_OLLAMA_MODEL || settings.ollamaModel,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeProvider(value: unknown, fallback: SemanticProvider): SemanticProvider {
  return value === "openai" || value === "ollama" ? value : fallback;
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

export function normalizeOllamaBaseUrl(value: unknown, fallback: string): string {
  const raw = normalizeString(value, fallback);
  if (!raw) return fallback;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return raw;
  }

  if (!url.port) {
    url.port = "11434";
  }

  return url.toString().replace(/\/+$/, "");
}

export function normalizeOpenAIBaseUrl(value: unknown, fallback: string): string {
  const raw = normalizeString(value, fallback);
  if (!raw) return fallback;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withProtocol).toString().replace(/\/+$/, "").replace(/\/embeddings$/i, "");
  } catch {
    return raw.replace(/\/+$/, "").replace(/\/embeddings$/i, "");
  }
}

export async function loadSemanticSettings(): Promise<SemanticSettings> {
  try {
    const raw = await fs.readFile(SEMANTIC_SETTINGS_PATH, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) return withEnvironment({ ...DEFAULT_SEMANTIC_SETTINGS });

    return withEnvironment({
      enabled:
        typeof parsed.enabled === "boolean"
          ? parsed.enabled
          : DEFAULT_SEMANTIC_SETTINGS.enabled,
      provider: normalizeProvider(parsed.provider, DEFAULT_SEMANTIC_SETTINGS.provider),
      openaiApiKey: normalizeString(parsed.openaiApiKey, DEFAULT_SEMANTIC_SETTINGS.openaiApiKey),
      openaiBaseUrl: normalizeOpenAIBaseUrl(
        parsed.openaiBaseUrl,
        DEFAULT_SEMANTIC_SETTINGS.openaiBaseUrl
      ),
      openaiModel: normalizeString(parsed.openaiModel, DEFAULT_SEMANTIC_SETTINGS.openaiModel),
      ollamaBaseUrl: normalizeOllamaBaseUrl(
        parsed.ollamaBaseUrl,
        DEFAULT_SEMANTIC_SETTINGS.ollamaBaseUrl
      ),
      ollamaModel: normalizeString(parsed.ollamaModel, DEFAULT_SEMANTIC_SETTINGS.ollamaModel),
      saveEmbeddingsToDisk:
        typeof parsed.saveEmbeddingsToDisk === "boolean"
          ? parsed.saveEmbeddingsToDisk
          : DEFAULT_SEMANTIC_SETTINGS.saveEmbeddingsToDisk,
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return withEnvironment({ ...DEFAULT_SEMANTIC_SETTINGS });
    throw error;
  }
}

export function validateSemanticSettings(settings: SemanticSettings): string | null {
  if (!settings.enabled) return "Semantic search is disabled.";

  if (settings.provider === "openai") {
    if (!settings.openaiApiKey) return "OpenAI API key is not configured.";
    if (!settings.openaiBaseUrl) return "OpenAI-compatible base URL is not configured.";
    if (!settings.openaiModel) return "OpenAI embedding model is not configured.";
    return null;
  }

  if (!settings.ollamaBaseUrl) return "Ollama base URL is not configured.";
  if (!settings.ollamaModel) return "Ollama embedding model is not configured.";
  return null;
}

export function getSemanticProviderModel(settings: SemanticSettings): string {
  return settings.provider === "openai" ? settings.openaiModel : settings.ollamaModel;
}
