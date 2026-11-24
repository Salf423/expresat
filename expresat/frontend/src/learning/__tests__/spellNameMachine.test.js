import { describe, it, expect } from 'vitest';
import {
  normalizeSpellName,
  letterToSignId,
  buildNameLetterTargets,
  SpellNameMachine,
} from '../spellNameMachine.js';
import { evaluateTargetSign } from '../targetEvaluator.js';
import { SYNTHETIC_PRESETS } from '../../recognition/index.js';

describe('learning/spellNameMachine — Reto "Deletrea tu nombre" en LSM', () => {
  it('normaliza tildes y caracteres no alfabéticos preservando A–Z y Ñ (NFC y NFD)', () => {
    expect(normalizeSpellName('José')).toBe('JOSE');
    expect(normalizeSpellName('Peña')).toBe('PEÑA');
    expect(normalizeSpellName('Sofía-María 123!')).toBe('SOFIAMARIA');
    // NFD decomposed 'n' + combining tilde must stay Ñ; ü -> U
    expect(normalizeSpellName('Nin\u0303a Güero')).toBe('NIÑAGUERO');
    expect(normalizeSpellName('   12345 !@# ')).toBe('');
    expect(normalizeSpellName('a'.repeat(40)).length).toBe(24);
  });

  it('mapea todas las letras de A–Z y Ñ a señas válidas del catálogo oficial LSM', () => {
    const alphabet = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';
    const { normalizedName, letters } = buildNameLetterTargets(alphabet, { maxLength: 27 });
    expect(normalizedName).toBe(alphabet);
    expect(letters.length).toBe(27);
    expect(letterToSignId('Ñ')).toBe('letra_enie');
    expect(letterToSignId('A')).toBe('letra_a');
    expect(letterToSignId('1')).toBeNull();
    for (const item of letters) {
      expect(item.sign).toBeTruthy();
      expect(item.sign.instructions.length).toBeGreaterThan(10);
    }
  });

  it('avanza letra por letra tras estabilidad mínima y completa el reto con mensaje personalizado', () => {
    const machine = new SpellNameMachine({
      name: 'Ana',
      minStableMs: 200,
      transitionCooldownMs: 250,
    });

    let snap = machine.getSnapshot();
    expect(snap.normalizedName).toBe('ANA');
    expect(snap.phase).toBe('practicing');
    expect(snap.currentLetter.char).toBe('A');
    expect(snap.completedCount).toBe(0);

    // 100 ms hold is not enough yet (anti-flicker)
    snap = machine.update({ matched: true, timestampMs: 1000 });
    expect(snap.currentIndex).toBe(0);
    snap = machine.update({ matched: true, timestampMs: 1100 });
    expect(snap.currentIndex).toBe(0);
    expect(snap.stabilityProgress).toBeGreaterThan(0);

    // 200 ms continuous hold validates 'A' and moves to 'N'
    snap = machine.update({ matched: true, timestampMs: 1210 });
    expect(snap.currentIndex).toBe(1);
    expect(snap.currentLetter.char).toBe('N');
    expect(snap.lastEvent?.type).toBe('letter_completed');

    // During transition cooldown (< 250 ms), matches do not prematurely advance 'N'
    snap = machine.update({ matched: true, timestampMs: 1350 });
    expect(snap.currentIndex).toBe(1);

    // After cooldown, hold 'N' for 200 ms -> advances to final 'A'
    snap = machine.update({ matched: true, timestampMs: 1500 });
    snap = machine.update({ matched: true, timestampMs: 1710 });
    expect(snap.currentIndex).toBe(2);
    expect(snap.currentLetter.char).toBe('A');

    // After cooldown, hold final 'A' for 200 ms -> challenge completed!
    snap = machine.update({ matched: true, timestampMs: 2000 });
    snap = machine.update({ matched: true, timestampMs: 2210 });
    expect(snap.completed).toBe(true);
    expect(snap.phase).toBe('completed');
    expect(snap.progressPct).toBe(100);
    expect(snap.celebrationMessage).toBe('¡Felicidades, ANA! Deletreaste tu nombre en LSM');
    expect(snap.lastEvent?.type).toBe('name_completed');
  });

  it('impide doble conteo en letras repetidas consecutivas (anti-rebote en ANNA) hasta relajar la mano', () => {
    const machine = new SpellNameMachine({
      name: 'Anna',
      minStableMs: 200,
      repeatReleaseMs: 320,
      transitionCooldownMs: 200,
    });

    // Validate 'A'
    machine.update({ matched: true, timestampMs: 1000 });
    let snap = machine.update({ matched: true, timestampMs: 1210 });
    expect(snap.currentLetter.char).toBe('N');
    expect(snap.phase).toBe('practicing');

    // Validate first 'N' -> enters awaiting_release because next letter is also 'N'
    machine.update({ matched: true, timestampMs: 1500 });
    snap = machine.update({ matched: true, timestampMs: 1710 });
    expect(snap.currentIndex).toBe(2);
    expect(snap.currentLetter.char).toBe('N');
    expect(snap.phase).toBe('awaiting_release');
    expect(snap.awaitingRelease).toBe(true);
    expect(snap.lastEvent?.nextNeedsRelease).toBe(true);

    // Holding the hand continuously for 2 seconds MUST NOT advance the second 'N'
    for (let t = 1800; t <= 3600; t += 100) {
      snap = machine.update({ matched: true, timestampMs: t });
      expect(snap.currentIndex).toBe(2);
      expect(snap.phase).toBe('awaiting_release');
    }

    // Brief flicker release (< 320 ms) followed by match resets release timer
    machine.update({ matched: false, timestampMs: 3700 });
    machine.update({ matched: false, timestampMs: 3850 });
    snap = machine.update({ matched: true, timestampMs: 3900 });
    expect(snap.phase).toBe('awaiting_release');

    // Proper continuous release >= 320 ms unlocks the second 'N'
    machine.update({ matched: false, timestampMs: 4000 });
    snap = machine.update({ matched: false, timestampMs: 4350 });
    expect(snap.phase).toBe('practicing');
    expect(snap.awaitingRelease).toBe(false);

    // Now holding 'N' for 200 ms validates the second 'N' and moves to final 'A'
    machine.update({ matched: true, timestampMs: 4500 });
    snap = machine.update({ matched: true, timestampMs: 4720 });
    expect(snap.currentIndex).toBe(3);
    expect(snap.currentLetter.char).toBe('A');
    expect(snap.phase).toBe('practicing');

    // Complete final 'A'
    machine.update({ matched: true, timestampMs: 5000 });
    snap = machine.update({ matched: true, timestampMs: 5220 });
    expect(snap.completed).toBe(true);
    expect(snap.celebrationMessage).toBe('¡Felicidades, ANNA! Deletreaste tu nombre en LSM');
  });

  it('se integra con evaluateTargetSign y landmarks sintéticos para validar letras reales en vivo', () => {
    const machine = new SpellNameMachine({
      name: 'ILY',
      minStableMs: 180,
      transitionCooldownMs: 200,
    });

    const hands = [
      SYNTHETIC_PRESETS.LETRA_I({ handedness: 'Right', palmFacing: 'FRONT' }),
      SYNTHETIC_PRESETS.LUNES({ handedness: 'Right', palmFacing: 'FRONT' }),
      SYNTHETIC_PRESETS.LETRA_Y({ handedness: 'Right', palmFacing: 'FRONT' }),
    ];

    let t = 1000;
    for (let i = 0; i < hands.length; i++) {
      const targetSign = machine.getSnapshot().currentLetter.sign;
      const evalRes = evaluateTargetSign(
        { rightHand: hands[i], timestamp: t },
        targetSign,
        []
      );
      expect(evalRes.matched).toBe(true);
      machine.update({ matched: evalRes.matched, timestampMs: t });
      machine.update({ matched: evalRes.matched, timestampMs: t + 200 });
      t += 500;
    }

    const done = machine.getSnapshot();
    expect(done.completed).toBe(true);
    expect(done.celebrationMessage).toBe('¡Felicidades, ILY! Deletreaste tu nombre en LSM');
  });
});
