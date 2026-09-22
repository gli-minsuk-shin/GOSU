import { Temporal } from 'temporal-polyfill';
import type { EmailPreparedActions } from './src/email-prepared-actions';

/** Conservative migration of saved summaries, never a reread of original mail or an AI call. */
export function recoverLegacyEmailTask(input: {
  title: string;
  summary: string;
  action?: string | undefined;
  receivedAt?: string | undefined;
  timeZone: string;
}): EmailPreparedActions['task'] {
  const text = [input.title, input.action ?? '', input.summary].join('\n').slice(0, 16000);
  const candidates: { date: string; instant: string | null; quote: string }[] = [];
  try {
    const anchor = input.receivedAt
      ? Temporal.Instant.from(input.receivedAt).toZonedDateTimeISO(input.timeZone)
      : null;
    for (const line of text.split('\n')) {
      const safe = line.replace(/https?:\/\/\S+/g, (value) => ' '.repeat(value.length));
      if (/\b(?:UTC|GMT|PST|PDT|EST|EDT)\b/i.test(safe)) continue;
      const dates = [
        ...safe.matchAll(
          /(?<![\dA-Za-z])(?:(\d{4})\s*(?:년|[-/.])\s*)?(\d{1,2})\s*(?:월|[-/])\s*(\d{1,2})\s*일?/g,
        ),
      ];
      for (const [index, m] of dates.entries()) {
        const prefix = safe
          .slice(
            Math.max(
              index ? dates[index - 1]!.index! + dates[index - 1]![0].length : 0,
              m.index! - 40,
            ),
            m.index!,
          )
          .split(/[,;.!?]/)
          .at(-1)!;
        const tail = safe
          .slice(m.index! + m[0].length, dates[index + 1]?.index ?? safe.length)
          .split(/[,;.!?]/)[0]!
          .slice(0, 70);
        if (
          !/(?:마감|기한|회신|제출|deadline|\bdue\b|\bby\b)/i.test(prefix) &&
          !/(?:까지|마감|기한|deadline|\bdue\b)/i.test(tail)
        )
          continue;
        if (/\b(?:UTC|GMT|PST|PDT|EST|EDT)\b/i.test(tail)) continue;
        const year = m[1] ? Number(m[1]) : anchor?.year;
        if (!year) continue;
        const day = Temporal.PlainDate.from(
          { year, month: Number(m[2]), day: Number(m[3]) },
          { overflow: 'reject' },
        );
        if (!m[1] && anchor && Temporal.PlainDate.compare(day, anchor.toPlainDate()) < 0)
          return null;
        const weekday = /^\s*\(([월화수목금토일])(?:요일)?\)/.exec(tail);
        if (weekday && '월화수목금토일'.indexOf(weekday[1]!) + 1 !== day.dayOfWeek) return null;
        const time = /(오전|오후)?\s*(\d{1,2})(?:시(?:\s*(\d{1,2})분)?|:(\d{2}))\s*(AM|PM)?/i.exec(
          tail,
        );
        let instant: string | null = null;
        if (time) {
          let hour = Number(time[2]);
          const period = time[1] ?? time[5]?.toUpperCase();
          if (period) {
            if (hour < 1 || hour > 12) return null;
            hour = (hour % 12) + (/오후|PM/.test(period) ? 12 : 0);
          }
          // Bare Korean 1–11시 has no reliable AM/PM. Preserve date, not an invented clock.
          if (period || time[4] !== undefined || hour === 0 || hour >= 12) {
            const clock = Temporal.PlainTime.from(
              { hour, minute: Number(time[3] ?? time[4] ?? 0) },
              { overflow: 'reject' },
            );
            instant = day
              .toPlainDateTime(clock)
              .toZonedDateTime(input.timeZone, { disambiguation: 'reject' })
              .toInstant()
              .toString();
          }
        }
        candidates.push({ date: day.toString(), instant, quote: line.trim().slice(0, 1000) });
      }
    }
    if (new Set(candidates.map((c) => c.date)).size !== 1) return null;
    const instants = [...new Set(candidates.flatMap((c) => (c.instant ? [c.instant] : [])))];
    if (instants.length > 1) return null;
    const evidence = candidates.find((c) => c.instant) ?? candidates[0]!;
    return {
      title: input.title.slice(0, 240),
      notes: [input.action, input.summary].filter(Boolean).join('\n').slice(0, 4000),
      dueDate: evidence.date,
      dueAt: instants[0] ?? null,
      timeZone: input.timeZone,
      evidenceQuote: evidence.quote,
      deadlineQuote: evidence.quote,
      notice:
        '이전 요약에 명시된 기한을 복원해 저장했습니다. 원문 재조회·추가 AI 호출은 하지 않았습니다. 연도 생략 시 메일 수신 연도를 기준으로 합니다.',
    };
  } catch {
    return null;
  }
}
