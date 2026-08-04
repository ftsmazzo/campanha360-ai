import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * Simula o fluxo de retry estrutural sem chamar OpenAI:
 * 1a resposta invalida nao e salva; 2a valida e a unica persistida.
 */
describe('09.7.2 AI format retry (simulated)', () => {
  it('primeira invalida + segunda valida salva somente a valida', () => {
    const saved: unknown[] = [];
    const attempts = [
      { sets: [{ greeting: 'Oi', body: 'x' }] }, // missing closing
      {
        sets: [
          {
            greeting: 'Ola!',
            body: 'Mensagem eleitoral completa sobre o bairro.',
            closing: 'Qual tema importa mais?',
            preservedFacts: true,
          },
        ],
      },
    ];

    let chosen: unknown = null;
    for (let i = 0; i < attempts.length; i++) {
      const payload = attempts[i];
      const hasClosing =
        Array.isArray((payload as { sets?: unknown[] }).sets) &&
        (payload as { sets: Array<{ closing?: unknown }> }).sets.every(
          (s) => s.closing != null && String(s.closing).trim() !== '',
        );
      if (!hasClosing) continue;
      chosen = payload;
      break;
    }
    if (chosen) saved.push(chosen);

    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0], attempts[1]);
  });

  it('duas respostas invalidas nao salvam nada', () => {
    const saved: unknown[] = [];
    const attempts = [
      { sets: [{ greeting: 'Oi' }] },
      { sets: [{ body: 'so corpo' }] },
    ];
    for (const payload of attempts) {
      const sets = (payload as { sets?: Array<Record<string, unknown>> }).sets;
      const complete =
        Array.isArray(sets) &&
        sets.every(
          (s) =>
            s.greeting != null &&
            s.body != null &&
            s.closing != null &&
            String(s.greeting).trim() &&
            String(s.body).trim() &&
            String(s.closing).trim(),
        );
      if (complete) saved.push(payload);
    }
    assert.equal(saved.length, 0);
  });
});
