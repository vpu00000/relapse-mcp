import crypto from "crypto";
import { clearSemanticIndexForClient } from "../../../semantic/vector-index.js";

export interface StoredScriptSource {
  debugId: string;
  path: string;
  source: string;
  sourceHash: string;
}

export interface ScriptSourceIndex {
  clientId: string;
  placeId: number;
  jobId: string;
  hasFinishedMapping: boolean;
  mappedSources: number;
  processedSources: number;
  skippedSources: number;
  sourcesToMap: number;
  sourceGap: number;
  sourceIndexComplete: boolean;
  scripts: StoredScriptSource[];
}

export type ScriptSourceIndexSummary = Omit<ScriptSourceIndex, "scripts">;

export interface ScriptSourceStoreIdentity {
  clientId: string;
  placeId: number;
  jobId: string;
}

interface ClientScriptSourceStore {
  placeId: number;
  jobId: string;
  hasFinishedMapping: boolean;
  processedSources: number;
  skippedSources: number;
  sourcesToMap: number;
  mappingSessionId?: string;
  mappingSessionStartedAt?: number;
  mappingRevision: number;
  activeScripts: Map<string, StoredScriptSource>;
  activeRevisionByScriptId: Map<string, number>;
  scripts: Map<string, StoredScriptSource>;
}

export interface UpsertScriptSourcesInput {
  hasFinishedMapping?: boolean;
  sourcesToMap?: number;
  processedSources?: number;
  skippedSources?: number;
  mappingSessionId?: unknown;
  mappingSessionStartedAt?: unknown;
  mappingRevision?: unknown;
  beginMappingSession?: unknown;
  scripts?: {
    debugId?: unknown;
    path?: unknown;
    source?: unknown;
  }[];
}

const storesByClientId: Map<string, ClientScriptSourceStore> = new Map();

function hashSource(source: string): string {
  return crypto.createHash("sha256").update(source).digest("hex");
}

function isUnusableDecompiledSource(source: string): boolean {
  const trimmed = source.trim();
  if (!trimmed) return true;
  const lowered = trimmed.toLowerCase();
  return (
    lowered.includes("failed to decompile") ||
    lowered.includes("decompiler server not active") ||
    lowered.includes("decompiler is not active")
  );
}

function getOrCreateStore(identity: ScriptSourceStoreIdentity): ClientScriptSourceStore {
  let store = storesByClientId.get(identity.clientId);
  if (!store || store.placeId !== identity.placeId || store.jobId !== identity.jobId) {
    if (store) clearSemanticIndexForClient(identity.clientId);
    store = {
      placeId: identity.placeId,
      jobId: identity.jobId,
      hasFinishedMapping: false,
      processedSources: 0,
      skippedSources: 0,
      sourcesToMap: 0,
      mappingRevision: -1,
      activeScripts: new Map(),
      activeRevisionByScriptId: new Map(),
      scripts: new Map(),
    };
    storesByClientId.set(identity.clientId, store);
  }
  return store;
}

function dropUnusableStoredScript(
  store: ClientScriptSourceStore,
  script: StoredScriptSource
): void {
  store.scripts.delete(script.debugId);
  store.activeScripts.delete(script.debugId);
  store.activeRevisionByScriptId.delete(script.debugId);
}

function canActivateScriptSource(
  store: ClientScriptSourceStore,
  input: UpsertScriptSourcesInput,
  inputRevision: number | undefined,
  debugId: string
): boolean {
  if (!store.mappingSessionId) return true;
  if (input.mappingSessionId !== store.mappingSessionId || inputRevision === undefined) return false;
  return inputRevision > (store.activeRevisionByScriptId.get(debugId) ?? -1);
}

function getScriptSourceIndexSummary(
  identity: ScriptSourceStoreIdentity,
  store: ClientScriptSourceStore
): ScriptSourceIndexSummary {
  const mappedSources = store.mappingSessionId
    ? store.activeScripts.size
    : store.scripts.size;
  const processedSources = Math.max(store.processedSources, mappedSources);
  const sourceGap = Math.max(store.skippedSources, store.sourcesToMap - mappedSources, 0);
  return {
    clientId: identity.clientId,
    placeId: store.placeId,
    jobId: store.jobId,
    hasFinishedMapping: store.hasFinishedMapping,
    mappedSources,
    processedSources,
    skippedSources: store.skippedSources,
    sourcesToMap: store.sourcesToMap,
    sourceGap,
    sourceIndexComplete:
      store.hasFinishedMapping &&
      processedSources >= store.sourcesToMap &&
      sourceGap === 0,
  };
}

function applyMappingRevision(
  store: ClientScriptSourceStore,
  input: UpsertScriptSourcesInput
): boolean {
  const usesRevisionProtocol =
    input.mappingSessionId !== undefined || input.mappingRevision !== undefined;
  if (!usesRevisionProtocol) return true;

  const sessionId =
    typeof input.mappingSessionId === "string" && input.mappingSessionId.length <= 160
      ? input.mappingSessionId
      : undefined;
  const revision =
    typeof input.mappingRevision === "number" && Number.isSafeInteger(input.mappingRevision)
      ? input.mappingRevision
      : undefined;
  const sessionStartedAt =
    typeof input.mappingSessionStartedAt === "number" &&
    Number.isSafeInteger(input.mappingSessionStartedAt) &&
    input.mappingSessionStartedAt >= 0
      ? input.mappingSessionStartedAt
      : undefined;

  if (!sessionId || revision === undefined || revision < 0) {
    return false;
  }

  if (input.beginMappingSession === true && store.mappingSessionId !== sessionId) {
    if (
      sessionStartedAt === undefined ||
      (store.mappingSessionStartedAt !== undefined &&
        sessionStartedAt <= store.mappingSessionStartedAt)
    ) {
      return false;
    }
    store.mappingSessionId = sessionId;
    store.mappingSessionStartedAt = sessionStartedAt;
    store.mappingRevision = -1;
    store.activeScripts.clear();
    store.activeRevisionByScriptId.clear();
    store.hasFinishedMapping = false;
    store.processedSources = 0;
    store.skippedSources = 0;
    store.sourcesToMap = 0;
  }

  if (store.mappingSessionId !== sessionId || revision <= store.mappingRevision) {
    return false;
  }
  store.mappingSessionId = sessionId;
  store.mappingRevision = revision;
  return true;
}

export function upsertScriptSources(
  identity: ScriptSourceStoreIdentity,
  input: UpsertScriptSourcesInput
): void {
  const store = getOrCreateStore(identity);
  const acceptsStatus = applyMappingRevision(store, input);
  const inputRevision =
    typeof input.mappingRevision === "number" && Number.isSafeInteger(input.mappingRevision)
      ? input.mappingRevision
      : undefined;

  if (acceptsStatus && typeof input.hasFinishedMapping === "boolean") {
    store.hasFinishedMapping = input.hasFinishedMapping;
  }

  if (acceptsStatus && typeof input.sourcesToMap === "number" && Number.isFinite(input.sourcesToMap)) {
    store.sourcesToMap = Math.max(0, Math.floor(input.sourcesToMap));
  }

  if (acceptsStatus && typeof input.processedSources === "number" && Number.isFinite(input.processedSources)) {
    store.processedSources = Math.max(0, Math.floor(input.processedSources));
  }

  if (acceptsStatus && typeof input.skippedSources === "number" && Number.isFinite(input.skippedSources)) {
    store.skippedSources = Math.max(0, Math.floor(input.skippedSources));
  }

  for (const script of input.scripts ?? []) {
    if (
      store.mappingSessionId &&
      typeof input.mappingSessionId === "string" &&
      input.mappingSessionId !== store.mappingSessionId
    ) {
      continue;
    }
    if (
      typeof script.debugId !== "string" ||
      typeof script.path !== "string" ||
      typeof script.source !== "string" ||
      isUnusableDecompiledSource(script.source)
    ) {
      continue;
    }

    const existing = store.scripts.get(script.debugId);
    const sourceHash = hashSource(script.source);

    if (existing && existing.sourceHash === sourceHash) {
      const updated = {
        ...existing,
        path: script.path,
      };
      store.scripts.set(script.debugId, updated);
      if (canActivateScriptSource(store, input, inputRevision, script.debugId)) {
        store.activeScripts.set(script.debugId, updated);
        if (inputRevision !== undefined) {
          store.activeRevisionByScriptId.set(script.debugId, inputRevision);
        }
      }
      continue;
    }

    const updated: StoredScriptSource = {
      debugId: script.debugId,
      path: script.path,
      source: script.source,
      sourceHash,
    };
    store.scripts.set(script.debugId, updated);
    if (canActivateScriptSource(store, input, inputRevision, script.debugId)) {
      store.activeScripts.set(script.debugId, updated);
      if (inputRevision !== undefined) {
        store.activeRevisionByScriptId.set(script.debugId, inputRevision);
      }
    }
  }
}

export function getScriptSourceIndex(identity: ScriptSourceStoreIdentity): ScriptSourceIndex {
  const store = getOrCreateStore(identity);
  const scripts = (store.mappingSessionId
    ? [...store.activeScripts.values()]
    : [...store.scripts.values()]
  ).filter((script) => {
    if (!isUnusableDecompiledSource(script.source)) return true;
    dropUnusableStoredScript(store, script);
    return false;
  });
  return {
    ...getScriptSourceIndexSummary(identity, store),
    scripts,
  };
}

export function clearScriptSourceIndex(clientId: string): void {
  storesByClientId.delete(clientId);
  clearSemanticIndexForClient(clientId);
}
