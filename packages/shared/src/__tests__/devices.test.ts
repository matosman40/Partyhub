import { describe, expect, it } from 'vitest';
import { classifyDevice, deviceKindFromUserAgent, orientationOf, deviceInfoSchema, uiScaleFor } from '../devices.js';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ipadOs13: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  ipadLegacy: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
  samsungTv: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/7.0 TV Safari/537.36',
  androidTv: 'Mozilla/5.0 (Linux; Android 12; BRAVIA 4K UR2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 Android TV',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
};

describe('identifiant navigateur (serveur)', () => {
  it.each([
    ['iPhone', UA.iphone, 'phone'],
    ['iPadOS 13+ (se présente comme Mac)', UA.ipadOs13, 'desktop'],
    ['iPad ancien', UA.ipadLegacy, 'tablet'],
    ['Android téléphone', UA.androidPhone, 'phone'],
    ['Android tablette', UA.androidTablet, 'tablet'],
    ['TV Samsung Tizen', UA.samsungTv, 'tv'],
    ['Android TV', UA.androidTv, 'tv'],
    ['Windows', UA.windows, 'desktop'],
    ['Mac', UA.mac, 'desktop'],
    ['Linux', UA.linux, 'desktop'],
  ])('%s', (_label, ua, expected) => {
    expect(deviceKindFromUserAgent(ua)).toBe(expected);
  });

  it('sans identifiant : inconnu', () => {
    expect(deviceKindFromUserAgent(undefined)).toBe('unknown');
  });
});

describe('classification avec la taille et le pointeur (navigateur)', () => {
  it('iPadOS tactile (Mac + points tactiles) est une tablette', () => {
    expect(classifyDevice({ userAgent: UA.ipadOs13, maxTouchPoints: 5 })).toBe('tablet');
  });

  it('pointeur grossier, petit écran : téléphone', () => {
    expect(classifyDevice({ coarsePointer: true, width: 390, height: 844 })).toBe('phone');
  });

  it('pointeur grossier, grand écran : tablette', () => {
    expect(classifyDevice({ coarsePointer: true, width: 1024, height: 768 })).toBe('tablet');
  });

  it('pointeur grossier, écran de 600 px au plus court : tablette (seuil)', () => {
    expect(classifyDevice({ coarsePointer: true, width: 600, height: 960 })).toBe('tablet');
  });

  it('grand écran sans souris ni doigt : téléviseur', () => {
    expect(classifyDevice({ canHover: false, width: 1920, height: 1080 })).toBe('tv');
  });

  it('écran avec souris : ordinateur', () => {
    expect(classifyDevice({ canHover: true, width: 1920, height: 1080 })).toBe('desktop');
  });

  it("l'identifiant explicite prime sur la taille", () => {
    expect(classifyDevice({ userAgent: UA.samsungTv, coarsePointer: true, width: 390, height: 844 })).toBe('tv');
  });

  it('rien de connu : inconnu', () => {
    expect(classifyDevice({})).toBe('unknown');
  });
});

describe('orientation et schéma', () => {
  it('orientation selon les dimensions', () => {
    expect(orientationOf(1024, 768)).toBe('landscape');
    expect(orientationOf(390, 844)).toBe('portrait');
    expect(orientationOf(800, 800)).toBe('landscape');
  });

  it('le schéma refuse un type inconnu et accepte les champs optionnels', () => {
    expect(deviceInfoSchema.safeParse({ kind: 'phone' }).success).toBe(true);
    expect(deviceInfoSchema.safeParse({ kind: 'fridge' }).success).toBe(false);
    expect(deviceInfoSchema.safeParse({ kind: 'tablet', width: -1 }).success).toBe(false);
  });
});

describe('taille d’affichage selon l’appareil et la résolution', () => {
  it('téléphone standard : taille de base', () => {
    expect(uiScaleFor('phone', 390, 844)).toBe(1);
  });

  it('grand téléphone : un peu plus grand', () => {
    expect(uiScaleFor('phone', 430, 932)).toBe(1.08);
  });

  it('tablette : plus grande qu’un téléphone, encore plus en haute résolution', () => {
    expect(uiScaleFor('tablet', 1024, 768)).toBe(1.1);
    expect(uiScaleFor('tablet', 1366, 1024)).toBe(1.23);
    expect(uiScaleFor('tablet', 1366, 1024)).toBeGreaterThan(uiScaleFor('tablet', 1024, 768));
  });

  it('ordinateur : la taille grandit avec la résolution logique', () => {
    expect(uiScaleFor('desktop', 1280, 720)).toBe(1);
    expect(uiScaleFor('desktop', 1920, 1080)).toBe(1.15);
    expect(uiScaleFor('desktop', 2560, 1440)).toBe(1.3);
    expect(uiScaleFor('desktop', 3840, 2160)).toBe(1.5);
  });

  it('téléviseur : plus grand que l’ordinateur, plafonné', () => {
    expect(uiScaleFor('tv', 1920, 1080)).toBeGreaterThan(uiScaleFor('desktop', 1920, 1080));
    expect(uiScaleFor('tv', 3840, 2160)).toBeLessThanOrEqual(1.8);
  });

  it('l’orientation ne change pas la taille d’un même écran', () => {
    expect(uiScaleFor('tablet', 768, 1024)).toBe(uiScaleFor('tablet', 1024, 768));
  });
});
