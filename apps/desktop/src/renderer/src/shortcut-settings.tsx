import { useEffect, useState } from 'react';
import {
  AssistantShortcutSchema,
  DEFAULT_ASSISTANT_SHORTCUT,
  shortcutLabel,
} from '../../shared/assistant-shortcut';
import {
  APP_SHORTCUT_TARGETS,
  DEFAULT_APP_SHORTCUTS,
  appShortcutOwner,
  type AppShortcuts,
  type AppShortcutTarget,
} from '../../shared/app-shortcuts';

const MODIFIERS = [
  'CommandOrControl+Shift',
  'CommandOrControl+Alt',
  'CommandOrControl+Alt+Shift',
  'Control+Shift',
  'Control+Alt',
  'Control+Alt+Shift',
] as const;
const KEYS = [
  'Space',
  'Enter',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
];
const SCREEN_LABEL: Record<AppShortcutTarget | 'assistant', string> = {
  assistant: 'AI 비서',
  calendar: '캘린더',
  tasks: '할 일',
  briefing: 'Briefing Lab',
  briefingRun: '새 브리핑 실행',
};
/** What the chord does. `briefingRun` is an action, not a screen: it has no "열기". */
const ACTION_LABEL: Record<AppShortcutTarget, string> = {
  calendar: '캘린더 열기',
  tasks: '할 일 열기',
  briefing: 'Briefing Lab 열기',
  briefingRun: '새 브리핑 실행',
};

/** Calendar, To-do and Briefing Lab chords: pick, save, turn off, or restore the default. */
function ScreenShortcuts({ assistantShortcut }: { assistantShortcut: string | null }) {
  const [saved, setSaved] = useState<AppShortcuts | null>(null),
    [draft, setDraft] = useState<AppShortcuts>(DEFAULT_APP_SHORTCUTS),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const load = window.gosu.app.getAppShortcuts;
    if (!load) return;
    void load()
      .then((value) => {
        if (active) {
          setSaved(value);
          setDraft(value);
        }
      })
      .catch(() => {
        if (active) setError('화면 단축키 설정을 불러오지 못했습니다.');
      });
    return () => {
      active = false;
    };
  }, []);
  if (!window.gosu.app.getAppShortcuts) return null;
  const conflict = (target: AppShortcutTarget) => {
    const chord = draft[target];
    if (!chord || assistantShortcut === null) return null;
    return appShortcutOwner(chord, draft, assistantShortcut, target);
  };
  const invalid = APP_SHORTCUT_TARGETS.some(
    (target) =>
      draft[target] !== null &&
      (!AssistantShortcutSchema.safeParse(draft[target]).success || conflict(target) !== null),
  );
  const save = async (next: AppShortcuts) => {
    setBusy(true);
    setError('');
    try {
      const result = await window.gosu.app.setAppShortcuts(next);
      setSaved(result);
      setDraft(result);
    } catch {
      setError('화면 단축키를 저장하지 못했습니다. 기존 설정은 유지됩니다.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="화면 단축키" style={{ marginTop: 18 }}>
      <h4 style={{ margin: '0 0 8px' }}>화면 바로 가기 · 새 브리핑 실행</h4>
      {APP_SHORTCUT_TARGETS.map((target) => {
        const chord = draft[target];
        const owner = conflict(target);
        return (
          <div
            key={target}
            style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', marginTop: 8 }}
          >
            <strong
              style={{ minWidth: 92 }}
              title={
                target === 'briefingRun'
                  ? 'Briefing Lab 화면에서 누르면 ‘브리핑 생성’ 버튼과 같이 새 브리핑을 실행합니다. 다른 화면에서는 Briefing Lab을 엽니다.'
                  : undefined
              }
            >
              {ACTION_LABEL[target]}
            </strong>
            <label>
              사용
              <input
                type="checkbox"
                aria-label={`${SCREEN_LABEL[target]} 단축키 사용`}
                disabled={saved === null || busy}
                checked={chord !== null}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    [target]: e.target.checked
                      ? (saved?.[target] ?? DEFAULT_APP_SHORTCUTS[target])
                      : null,
                  })
                }
              />
            </label>
            <label>
              보조키
              <select
                aria-label={`${SCREEN_LABEL[target]} 단축키 보조키`}
                disabled={saved === null || busy || chord === null}
                value={(chord ?? DEFAULT_APP_SHORTCUTS[target]!).split('+').slice(0, -1).join('+')}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    [target]: `${e.target.value}+${(chord ?? 'X').split('+').at(-1)}`,
                  })
                }
              >
                {MODIFIERS.map((v) => (
                  <option key={v} value={v}>
                    {shortcutLabel(v)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              키
              <select
                aria-label={`${SCREEN_LABEL[target]} 단축키 키`}
                disabled={saved === null || busy || chord === null}
                value={(chord ?? DEFAULT_APP_SHORTCUTS[target]!).split('+').at(-1)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    [target]: `${(chord ?? DEFAULT_APP_SHORTCUTS[target]!).split('+').slice(0, -1).join('+')}+${e.target.value}`,
                  })
                }
              >
                {KEYS.map((v) => (
                  <option key={v} value={v}>
                    {v === 'Space' ? 'Spacebar' : v === 'Enter' ? 'Enter (Return)' : v}
                  </option>
                ))}
              </select>
            </label>
            <span>{chord ? shortcutLabel(chord) : '사용 안 함'}</span>
            {owner && (
              <span role="alert">
                {SCREEN_LABEL[owner]} 단축키와 같습니다. 다른 키를 선택해주세요.
              </span>
            )}
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <button
          className="primary-button"
          type="button"
          disabled={
            saved === null || busy || invalid || JSON.stringify(draft) === JSON.stringify(saved)
          }
          onClick={() => void save(draft)}
        >
          화면 단축키 저장
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={saved === null || busy}
          onClick={() => void save(DEFAULT_APP_SHORTCUTS)}
        >
          화면 단축키 기본값
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export function ShortcutSettings() {
  const [value, setValue] = useState<string | null>(null),
    [draft, setDraft] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void window.gosu.app
      .getAssistantShortcut()
      .then((v) => {
        if (active) {
          setValue(v);
          setDraft(v);
        }
      })
      .catch(() => {
        if (active) setError('단축키 설정을 불러오지 못했습니다.');
      });
    return () => {
      active = false;
    };
  }, []);
  const save = async (next: string) => {
    if (!AssistantShortcutSchema.safeParse(next).success) {
      setError('사용할 수 없는 키 조합입니다. 다른 키를 선택해주세요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await window.gosu.app.setAssistantShortcut(next);
      setValue(result);
      setDraft(result);
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message.includes('shortcut_in_use')
          ? '이미 다른 화면이 쓰는 단축키입니다. 기존 설정은 유지됩니다.'
          : '단축키를 저장하지 못했습니다. 기존 설정은 유지됩니다.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="settings-card">
      <h3>단축키</h3>
      <p>
        <strong>AI 비서 열기</strong> · {value ? shortcutLabel(value) : '불러오는 중…'}
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label>
          보조키
          <select
            aria-label="단축키 보조키"
            disabled={value === null || busy}
            value={draft.split('+').slice(0, -1).join('+')}
            onChange={(e) => {
              setDraft(`${e.target.value}+${draft.split('+').at(-1) || 'Space'}`);
              setError('');
            }}
          >
            {[
              'CommandOrControl+Shift',
              'CommandOrControl+Alt',
              'CommandOrControl+Alt+Shift',
              'Control+Shift',
              'Control+Alt',
              'Control+Alt+Shift',
            ].map((v) => (
              <option key={v} value={v}>
                {shortcutLabel(v)}
              </option>
            ))}
          </select>
        </label>
        <label>
          키
          <select
            aria-label="단축키 키"
            disabled={value === null || busy}
            value={draft.split('+').at(-1) || 'Space'}
            onChange={(e) => {
              setDraft(`${draft.split('+').slice(0, -1).join('+')}+${e.target.value}`);
              setError('');
            }}
          >
            {[
              'Space',
              ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
              ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
            ].map((v) => (
              <option key={v} value={v}>
                {v === 'Space' ? 'Spacebar' : v === 'Enter' ? 'Enter (Return)' : v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p>
        보조키와 키를 선택한 뒤 저장하세요. 한글 입력 상태에서도 변경할 수 있습니다. GOSU 앱이
        활성화되어 있을 때 AI 비서를 열고 입력창으로 이동합니다. macOS가 먼저 사용하는 조합은 다른
        키로 바꿔주세요.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          className="primary-button"
          type="button"
          disabled={
            value === null ||
            busy ||
            draft === value ||
            !AssistantShortcutSchema.safeParse(draft).success
          }
          onClick={() => void save(draft)}
        >
          저장
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={value === null || busy}
          onClick={() => void save(DEFAULT_ASSISTANT_SHORTCUT)}
        >
          기본값으로 복원
        </button>
      </div>
      {draft && !AssistantShortcutSchema.safeParse(draft).success && (
        <p role="alert">이 키 조합은 사용할 수 없습니다. 다른 키를 선택해주세요.</p>
      )}
      {value === draft && value && <small>저장됨 · 앱 재시작·업데이트 후에도 유지</small>}
      {error && <p role="alert">{error}</p>}
      <ScreenShortcuts assistantShortcut={value} />
    </article>
  );
}
