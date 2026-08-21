/**
 * A pinned, fail-closed launcher for Hermes ACP 0.19.1.
 *
 * GOSU deliberately does not execute the public `hermes acp` launcher directly: that entrypoint
 * reloads a user-controlled dotenv/config and provider plugins before its approval hooks freeze.
 * This wrapper loads only the already-prepared, project/session-isolated profile, reasserts the
 * GOSU safety flags before any tool module import, seals provider discovery, removes provider
 * credentials from the tool environment, and restricts every agent to an empty native tool surface.
 */
import { HERMES_PROVIDER_ENVIRONMENT_NAME_LIST } from './hermes-acp-profile';
import { GOSU_HERMES_VERSION } from './hermes-runtime-bundle';

export const HERMES_ACP_READ_ONLY_TOOLSET = 'gosu-acp-readonly';
export const HERMES_ACP_DENIED_TOOLSET = 'gosu-acp-denied';
// Hermes remains useful as a selected provider and as a high-level Codex delegation target, but
// its native tool surface is intentionally empty. This prevents Hermes' background delegation,
// transcript/cache persistence, shell/file tools, plugins, and web backends from crossing GOSU's
// local-only context boundary until each capability has its own reviewed bridge.
export const HERMES_ACP_READ_ONLY_TOOLS = [] as const;

export const HERMES_SEALED_ACP_SOURCE = String.raw`
import asyncio
import copy
import hashlib
import hmac
import inspect
import json
import os
import sys
import tomllib
from urllib.parse import urlsplit, urlunsplit

SUPPORTED_HERMES_VERSION = ${JSON.stringify(GOSU_HERMES_VERSION)}
DENIED_RUNTIME_PROVIDERS = {
    "moa",
    "copilot-acp",
    "github-copilot-acp",
    "copilot-acp-agent",
}
ALLOWED_RUNTIME_API_MODES = {
    "chat_completions",
    "codex_responses",
    "anthropic_messages",
    "bedrock_converse",
}
GOSU_READ_ONLY_TOOLSET = ${JSON.stringify(HERMES_ACP_READ_ONLY_TOOLSET)}
GOSU_DENIED_TOOLSET = ${JSON.stringify(HERMES_ACP_DENIED_TOOLSET)}
GOSU_READ_ONLY_TOOLS = ${JSON.stringify(HERMES_ACP_READ_ONLY_TOOLS)}
GOSU_READ_ONLY_TOOL_NAMES = frozenset(GOSU_READ_ONLY_TOOLS)
GOSU_PROVIDER_ENVIRONMENT_NAMES = ${JSON.stringify(HERMES_PROVIDER_ENVIRONMENT_NAME_LIST)}

def _fail(code):
    raise RuntimeError(code)

def _assert_version(root):
    with open(os.path.join(root, "pyproject.toml"), "rb") as project_file:
        metadata = tomllib.load(project_file)
    if str((metadata.get("project") or {}).get("version") or "").strip() != SUPPORTED_HERMES_VERSION:
        _fail("unsupported_hermes_version")
    import hermes_cli
    if str(getattr(hermes_cli, "__version__", "")).strip() != SUPPORTED_HERMES_VERSION:
        _fail("hermes_version_mismatch")

def _seal_provider_registry():
    import providers as provider_profiles
    if getattr(provider_profiles, "_discovered", True):
        _fail("provider_discovery_already_started")
    import_plugin_dir = getattr(provider_profiles, "_import_plugin_dir", None)
    if not callable(getattr(provider_profiles, "_user_plugins_dir", None)) or not callable(import_plugin_dir):
        _fail("unsupported_hermes_provider_registry")
    def sealed_import_plugin_dir(plugin_dir, source):
        if source != "bundled":
            _fail("user_provider_plugin_blocked")
        return import_plugin_dir(plugin_dir, source)
    provider_profiles._user_plugins_dir = lambda: None
    provider_profiles._import_plugin_dir = sealed_import_plugin_dir

def _seal_credential_pool_runtime():
    import agent.credential_pool as credential_pool_module
    CredentialPool = getattr(credential_pool_module, "CredentialPool", None)
    PooledCredential = getattr(credential_pool_module, "PooledCredential", None)
    if not isinstance(CredentialPool, type) or not isinstance(PooledCredential, type):
        _fail("unsupported_hermes_credential_pool")
    original_peek = getattr(CredentialPool, "peek", None)
    if not callable(original_peek):
        _fail("unsupported_hermes_credential_pool")

    def deny_pool_mutation(*_args, **_kwargs):
        _fail("credential_pool_mutation_not_allowed")

    def select_read_only(pool):
        if type(pool) is not CredentialPool:
            _fail("credential_pool_runtime_not_supported")
        entry = original_peek(pool)
        if entry is not None:
            if type(entry) is not PooledCredential:
                _fail("pooled_credential_runtime_invalid")
            # Set only the in-process cursor used for continuity validation. The pinned peek path
            # cannot rotate, refresh, increment use, or persist credential state.
            pool._current_id = entry.id
        return entry

    CredentialPool.select = select_read_only
    CredentialPool.try_refresh_current = deny_pool_mutation
    CredentialPool._persist = deny_pool_mutation
    credential_pool_module.write_credential_pool = deny_pool_mutation

def _model_config(config):
    value = config.get("model") or {}
    if isinstance(value, str):
        return {"default": value}
    return value if isinstance(value, dict) else {}

def _bounded_route_value(value, maximum, code):
    text = str(value or "").strip()
    if len(text.encode("utf-8")) > maximum:
        _fail(code)
    return text

def _pooled_credential_snapshot(runtime):
    pool = runtime.get("credential_pool")
    if pool is None:
        return None
    try:
        from agent.credential_pool import CredentialPool, PooledCredential
        if type(pool) is not CredentialPool:
            _fail("credential_pool_runtime_not_supported")
        api_key = runtime.get("api_key")
        if not isinstance(api_key, str) or not api_key:
            _fail("pooled_credential_runtime_invalid")
        current = pool.current()
        if type(current) is not PooledCredential:
            _fail("pooled_credential_runtime_invalid")
        runtime_api_key = current.runtime_api_key
        if not isinstance(runtime_api_key, str) or not runtime_api_key or runtime_api_key != api_key:
            _fail("pooled_credential_runtime_invalid")
        entry_id = pool.entry_id_for_api_key(api_key)
        if not isinstance(entry_id, str) or not entry_id.strip() or current.id != entry_id:
            _fail("pooled_credential_runtime_invalid")
        pool_provider = _bounded_route_value(
            pool.provider, 128, "configured_credential_identity_invalid"
        ).lower()
        entry_provider = _bounded_route_value(
            current.provider, 128, "configured_credential_identity_invalid"
        ).lower()
        runtime_provider = _bounded_route_value(
            runtime.get("provider"), 128, "configured_credential_identity_invalid"
        ).lower()
        if not runtime_provider or pool_provider != runtime_provider or entry_provider != runtime_provider:
            _fail("pooled_credential_runtime_invalid")
        return {
            "kind": "bundled-string-pool",
            "pool_provider": pool_provider,
            "entry_provider": entry_provider,
            "entry_id": _bounded_route_value(
                entry_id, 256, "configured_credential_identity_invalid"
            ),
            "entry_source": _bounded_route_value(
                current.source, 256, "configured_credential_identity_invalid"
            ),
        }
    except RuntimeError:
        raise
    except Exception:
        _fail("pooled_credential_runtime_invalid")

def _credential_identity(runtime):
    api_key = runtime.get("api_key")
    if isinstance(api_key, str):
        secret_kind = "string" if api_key else "none"
    elif callable(api_key):
        secret_kind = "callable:" + _bounded_route_value(
            getattr(api_key, "__module__", "") + "." + getattr(api_key, "__qualname__", type(api_key).__qualname__),
            256,
            "configured_credential_identity_invalid",
        )
    elif api_key is None:
        secret_kind = "none"
    else:
        secret_kind = "opaque:" + type(api_key).__module__ + "." + type(api_key).__qualname__

    pool_snapshot = _pooled_credential_snapshot(runtime)
    return {
        "kind": _bounded_route_value(secret_kind, 320, "configured_credential_identity_invalid"),
        "pool": pool_snapshot,
        "source": _bounded_route_value(runtime.get("source"), 256, "configured_credential_identity_invalid"),
        "auth_mode": _bounded_route_value(runtime.get("auth_mode"), 128, "configured_credential_identity_invalid"),
    }

def _normalized_full_base_url(runtime):
    from hermes_cli.route_identity import normalize_route_base_url
    return _bounded_route_value(
        normalize_route_base_url(runtime.get("base_url")), 4096, "configured_route_identity_invalid"
    )

def _nonsecret_base_url(runtime):
    normalized = _normalized_full_base_url(runtime)
    if not normalized:
        return ""
    try:
        parsed = urlsplit(normalized)
        hostname = parsed.hostname
        if not parsed.scheme or not hostname:
            raise ValueError("invalid route")
        host = hostname.lower()
        if ":" in host:
            host = "[" + host + "]"
        port = parsed.port
        if port is not None and (parsed.scheme.lower(), port) not in {("http", 80), ("https", 443)}:
            host = host + ":" + str(port)
        return urlunsplit((parsed.scheme.lower(), host, parsed.path, "", ""))
    except (TypeError, ValueError):
        _fail("configured_route_identity_invalid")

def _route_fingerprint(model, runtime):
    route = {
        "version": 1,
        "model": _bounded_route_value(model, 256, "configured_route_identity_invalid"),
        "provider": _bounded_route_value(runtime.get("provider"), 128, "configured_route_identity_invalid").lower(),
        "requested_provider": _bounded_route_value(runtime.get("requested_provider"), 128, "configured_route_identity_invalid").lower(),
        "api_mode": _bounded_route_value(runtime.get("api_mode"), 64, "configured_route_identity_invalid").lower(),
        "base_url": _nonsecret_base_url(runtime),
        "region": _bounded_route_value(runtime.get("region"), 128, "configured_route_identity_invalid"),
        "credential": _credential_identity(runtime),
    }
    canonical = json.dumps(route, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

def _credential_proof(model, runtime, binding_key):
    if len(binding_key) != 64:
        _fail("credential_binding_key_invalid")
    try:
        key = bytes.fromhex(binding_key)
    except ValueError:
        _fail("credential_binding_key_invalid")
    api_key = runtime.get("api_key")
    if isinstance(api_key, str):
        material = {"kind": "string", "value": api_key}
    elif callable(api_key):
        material = {
            "kind": "callable",
            "identity": _bounded_route_value(
                getattr(api_key, "__module__", "") + "." + getattr(api_key, "__qualname__", type(api_key).__qualname__),
                256,
                "configured_credential_identity_invalid",
            ),
        }
    elif api_key is None:
        material = {"kind": "none", "value": ""}
    else:
        material = {"kind": "opaque", "identity": type(api_key).__module__ + "." + type(api_key).__qualname__}
    proof_input = {
        "version": 1,
        "route_fingerprint": _route_fingerprint(model, runtime),
        "full_base_url": _normalized_full_base_url(runtime),
        "credential": material,
        "selection": _credential_identity(runtime),
    }
    canonical = json.dumps(proof_input, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hmac.new(key, canonical.encode("utf-8"), hashlib.sha256).hexdigest()

def _safe_config(original, model, provider):
    original_model = _model_config(original)
    model_config = {"default": model, "provider": provider}
    context_length = original_model.get("context_length")
    if isinstance(context_length, int) and not isinstance(context_length, bool) and context_length > 0:
        model_config["context_length"] = context_length
    return {
        "model": model_config,
        "approvals": {"mode": "manual", "cron_mode": "deny", "timeout": 55},
        "memory": {"memory_enabled": False, "user_profile_enabled": False},
        "mcp_servers": {},
        "context": {"engine": "compressor"},
        "compression": {"enabled": False},
        "display": {"show_commentary": False},
        "sessions": {"auto_title": False},
        "agent": {
            "environment_probe": False,
            "tool_use_enforcement": False,
            "task_completion_guidance": False,
            "parallel_tool_call_guidance": False,
            "api_max_retries": 2,
        },
    }

def _seal_session_persistence_runtime():
    import hermes_state as hermes_state_module
    session_db_class = getattr(hermes_state_module, "SessionDB", None)
    sqlite_module = getattr(hermes_state_module, "sqlite3", None)
    sqlite_connect = getattr(sqlite_module, "connect", None)
    if not isinstance(session_db_class, type) or not callable(sqlite_connect):
        _fail("unsupported_hermes_persistence_runtime")

    def deny_session_db_open(_self, *_args, **_kwargs):
        _fail("hermes_persistence_not_allowed")

    def deny_file_sqlite(database, *args, **kwargs):
        if str(database) != ":memory:":
            _fail("hermes_persistence_not_allowed")
        return sqlite_connect(database, *args, **kwargs)

    # Keep the pinned class surface intact for imports/type checks, but make every unexpected
    # constructor fail before SQLite can create state.db, WAL, or SHM files in the isolated profile.
    session_db_class.__init__ = deny_session_db_open
    sqlite_module.connect = deny_file_sqlite

def _main():
    if len(sys.argv) != 5:
        _fail("invalid_arguments")
    root = os.path.abspath(sys.argv[1])
    expected_model = str(sys.argv[2]).strip()
    expected_provider = str(sys.argv[3]).strip()
    expected_route_fingerprint = str(sys.argv[4]).strip().lower()
    credential_binding_key = os.environ.pop("GOSU_HERMES_CREDENTIAL_BINDING_KEY", "")
    expected_credential_proof = os.environ.pop("GOSU_HERMES_EXPECTED_CREDENTIAL_PROOF", "").strip().lower()
    hermes_home = os.path.abspath(os.environ.get("HERMES_HOME") or "")
    if not os.path.isdir(root) or not os.path.isdir(hermes_home):
        _fail("invalid_runtime_paths")
    if (
        not expected_model
        or not expected_provider
        or len(expected_route_fingerprint) != 64
        or len(expected_credential_proof) != 64
    ):
        _fail("configured_runtime_missing")

    sys.path.insert(0, root)
    _assert_version(root)

    # These values are reasserted after profile preparation and before importing the ACP server or
    # any tool approval module. A BYO dotenv cannot switch GOSU into YOLO or configured-MCP mode.
    os.environ["HERMES_SAFE_MODE"] = "1"
    os.environ["HERMES_IGNORE_RULES"] = "1"
    os.environ["HERMES_YOLO_MODE"] = "0"
    os.environ["HERMES_ACP_AUTO_APPROVE"] = "ask"
    os.environ["HERMES_ACP_SKIP_CONFIGURED_MCP"] = "1"
    _seal_provider_registry()
    _seal_credential_pool_runtime()

    import hermes_cli.config as config_module
    original = config_module.load_config_readonly()
    model_cfg = _model_config(original)
    model = str(os.environ.get("HERMES_INFERENCE_MODEL") or model_cfg.get("default") or model_cfg.get("model") or "").strip()
    provider = str(os.environ.get("HERMES_INFERENCE_PROVIDER") or model_cfg.get("provider") or "").strip()
    if model != expected_model or provider != expected_provider:
        _fail("configured_runtime_changed")
    if provider.lower() in DENIED_RUNTIME_PROVIDERS:
        _fail("configured_provider_not_allowed")

    safe_config = _safe_config(original, model, provider)
    config_module.load_config = lambda: copy.deepcopy(safe_config)
    config_module.load_config_readonly = lambda: copy.deepcopy(safe_config)

    import hermes_cli.auth as auth_module
    if not callable(getattr(auth_module, "resolve_external_process_provider_credentials", None)):
        _fail("unsupported_hermes_auth_runtime")
    auth_module.resolve_external_process_provider_credentials = lambda _provider_id: _fail("external_process_runtime_not_allowed")

    import hermes_cli.runtime_provider as runtime_provider_module
    runtime_provider_module.resolve_nous_runtime_credentials = (
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("credential_pool_refresh_not_allowed")
        )
    )
    runtime = runtime_provider_module.resolve_runtime_provider(requested=provider, target_model=model)
    actual_provider = str(runtime.get("provider") or "").strip()
    actual_mode = str(runtime.get("api_mode") or "").strip().lower()
    if actual_provider != expected_provider or actual_mode not in ALLOWED_RUNTIME_API_MODES:
        _fail("configured_runtime_changed")
    if any(runtime.get(field) for field in ("command", "args", "acp_command", "acp_args")):
        _fail("external_process_runtime_not_allowed")
    api_key = runtime.get("api_key")
    if callable(api_key) or (api_key is not None and not isinstance(api_key, str)):
        _fail("opaque_credential_runtime_not_supported")
    if actual_provider.lower() == "bedrock" or api_key == "aws-sdk":
        _fail("implicit_credential_runtime_not_supported")
    if runtime.get("credential_pool") is not None:
        _pooled_credential_snapshot(runtime)
    if any(name.startswith("_hermes_user_provider_") for name in sys.modules):
        _fail("user_provider_plugin_loaded")
    if _route_fingerprint(model, runtime) != expected_route_fingerprint:
        _fail("configured_runtime_changed")
    if _credential_proof(model, runtime, credential_binding_key) != expected_credential_proof:
        _fail("configured_runtime_changed")
    runtime["credential_pool"] = None

    # Preserve only the already-validated inference route in this process. Provider/AWS values
    # are removed before run_agent (and therefore any tool module) is imported. The sealed agent
    # has no native tools, but this scrub also protects against upstream initialization changes.
    sealed_runtime = {
        "provider": actual_provider,
        "requested_provider": expected_provider,
        "api_mode": actual_mode,
        "base_url": runtime.get("base_url"),
        "api_key": api_key,
        "command": None,
        "args": [],
        "acp_command": None,
        "acp_args": [],
        "credential_pool": None,
        "source": "gosu-validated-runtime",
    }
    if "run_agent" in sys.modules or any(
        name == "tools" or name.startswith("tools.") for name in sys.modules
    ):
        _fail("tool_runtime_imported_before_credential_scrub")
    for environment_name in GOSU_PROVIDER_ENVIRONMENT_NAMES:
        os.environ.pop(environment_name, None)
    _seal_session_persistence_runtime()

    def sealed_resolve_runtime_provider(requested=None, target_model=None, **_kwargs):
        requested_value = str(requested or "").strip()
        target_value = str(target_model or "").strip()
        if requested_value and requested_value not in {expected_provider, actual_provider}:
            _fail("configured_runtime_changed")
        if target_value and target_value != expected_model:
            _fail("configured_runtime_changed")
        return dict(sealed_runtime)

    runtime_provider_module.resolve_runtime_provider = sealed_resolve_runtime_provider

    # run_agent.py normally reloads HERMES_HOME/.env with override=True during import. The isolated
    # profile already supplied an allowlisted credential environment; prevent a second dotenv pass
    # from changing safety flags before tools.approval freezes YOLO state.
    if "run_agent" in sys.modules:
        _fail("run_agent_imported_before_safety_seal")
    import hermes_cli.env_loader as env_loader
    env_loader.load_hermes_dotenv = lambda *args, **kwargs: []
    import run_agent
    os.environ["HERMES_SAFE_MODE"] = "1"
    os.environ["HERMES_IGNORE_RULES"] = "1"
    os.environ["HERMES_YOLO_MODE"] = "0"
    os.environ["HERMES_ACP_AUTO_APPROVE"] = "ask"
    os.environ["HERMES_ACP_SKIP_CONFIGURED_MCP"] = "1"

    import toolsets as toolsets_module
    if GOSU_READ_ONLY_TOOLSET in toolsets_module.TOOLSETS or GOSU_DENIED_TOOLSET in toolsets_module.TOOLSETS:
        _fail("gosu_toolset_collision")
    known_tool_names = set()
    for toolset_definition in toolsets_module.TOOLSETS.values():
        if isinstance(toolset_definition, dict):
            known_tool_names.update(toolset_definition.get("tools") or [])
    toolsets_module.TOOLSETS[GOSU_READ_ONLY_TOOLSET] = {
        "description": "GOSU ACP empty native tool surface",
        "tools": list(GOSU_READ_ONLY_TOOLS),
        "includes": [],
    }
    toolsets_module.TOOLSETS[GOSU_DENIED_TOOLSET] = {
        "description": "Everything outside GOSU's ACP read-only capability boundary",
        "tools": sorted(known_tool_names - GOSU_READ_ONLY_TOOL_NAMES),
        "includes": [],
    }

    OriginalAIAgent = run_agent.AIAgent
    required = {
        "enabled_toolsets", "disabled_toolsets", "skip_context_files", "skip_memory",
        "session_db", "quiet_mode", "platform"
    }
    if not required.issubset(inspect.signature(OriginalAIAgent).parameters):
        _fail("unsupported_hermes_runtime")

    class GosuAIAgent(OriginalAIAgent):
        def __setattr__(self, name, value):
            if name == "enabled_toolsets":
                value = [GOSU_READ_ONLY_TOOLSET]
            elif name == "disabled_toolsets":
                value = [GOSU_DENIED_TOOLSET]
            elif name == "tools" and value is not None:
                if any(not isinstance(tool, dict) for tool in value):
                    _fail("hermes_tool_surface_widened")
                unexpected = {
                    str((tool.get("function") or {}).get("name") or "")
                    for tool in value
                    if isinstance(tool, dict)
                } - GOSU_READ_ONLY_TOOL_NAMES
                if unexpected:
                    _fail("hermes_tool_surface_widened")
            elif name == "valid_tool_names" and value is not None:
                unexpected = set(value) - GOSU_READ_ONLY_TOOL_NAMES
                if unexpected:
                    _fail("hermes_tool_surface_widened")
            super().__setattr__(name, value)

        def __init__(self, *args, **kwargs):
            kwargs["model"] = expected_model
            kwargs["provider"] = actual_provider
            kwargs["requested_provider"] = expected_provider
            kwargs["api_mode"] = actual_mode
            kwargs["base_url"] = sealed_runtime.get("base_url")
            kwargs["api_key"] = sealed_runtime.get("api_key")
            kwargs["command"] = None
            kwargs["args"] = []
            kwargs["acp_command"] = None
            kwargs["acp_args"] = []
            kwargs["credential_pool"] = None
            kwargs["enabled_toolsets"] = [GOSU_READ_ONLY_TOOLSET]
            kwargs["disabled_toolsets"] = [GOSU_DENIED_TOOLSET]
            kwargs["skip_context_files"] = True
            kwargs["load_soul_identity"] = False
            kwargs["skip_memory"] = True
            kwargs["fallback_model"] = None
            kwargs["checkpoints_enabled"] = False
            kwargs["session_db"] = None
            super().__init__(*args, **kwargs)
            if getattr(self, "tools", None):
                _fail("hermes_native_tool_surface_not_empty")
            if getattr(self, "valid_tool_names", None):
                _fail("hermes_native_tool_surface_not_empty")
            self._persist_disabled = True
            self._skip_mcp_refresh = True

    run_agent.AIAgent = GosuAIAgent

    import acp_adapter.session as session_module
    session_module._expand_acp_enabled_toolsets = (
        lambda toolsets=None, mcp_server_names=None: [GOSU_READ_ONLY_TOOLSET]
    )
    session_module.SessionManager._get_db = lambda self: None
    session_module.SessionManager._persist = lambda self, state: None
    session_module.SessionManager._restore = lambda self, session_id: None
    session_module.SessionManager._delete_persisted = lambda self, session_id: False

    import tools.mcp_tool as mcp_tool_module
    mcp_tool_module.register_mcp_servers = lambda *_args, **_kwargs: _fail("mcp_runtime_not_allowed")

    from acp_adapter.entry import _setup_logging
    _setup_logging()
    import acp
    from acp_adapter.server import HermesACPAgent
    agent = HermesACPAgent()
    asyncio.run(acp.run_agent(agent, use_unstable_protocol=True))

try:
    _main()
except KeyboardInterrupt:
    pass
except Exception as exc:
    code = str(exc)
    if code in {"unsupported_hermes_version", "hermes_version_mismatch"}:
        code = "hermes_version_unsupported_adapter_update_required"
    elif not code.replace("_", "").isalnum():
        code = type(exc).__name__
    sys.stderr.write("gosu_hermes_acp_failed:" + code + "\n")
    sys.stderr.flush()
    raise SystemExit(1)
`;

export function sealedHermesAcpCommand(input: {
  pythonPath: string;
  rootPath: string;
  configuredModelId: string;
  configuredProviderId: string;
  routeFingerprint: string;
}) {
  return {
    executable: input.pythonPath,
    args: [
      '-I',
      '-B',
      '-c',
      HERMES_SEALED_ACP_SOURCE,
      input.rootPath,
      input.configuredModelId,
      input.configuredProviderId,
      input.routeFingerprint,
    ] as const,
  };
}
