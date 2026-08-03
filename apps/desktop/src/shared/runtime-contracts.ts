export type ComponentReadiness = Readonly<{
  ready: boolean;
  detail: string;
}>;

export type CodexAvailability = Readonly<{
  ready: boolean;
  detail: 'bundled_codex_ready' | 'configured_codex_ready' | 'codex_executable_unavailable';
}>;

export type RuntimeReadiness = Readonly<{
  status: 'ready' | 'degraded';
  app: Readonly<{
    version: string;
    platform: string;
    packaged: boolean;
  }>;
  localData: ComponentReadiness;
  codex: CodexAvailability;
  syncApi: ComponentReadiness;
}>;
