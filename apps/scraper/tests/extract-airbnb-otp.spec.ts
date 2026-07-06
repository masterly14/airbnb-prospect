import { test, expect } from '@playwright/test';
import { extractAirbnbOtp } from './helpers/composio-gmail';

test.describe('extractAirbnbOtp', () => {
  test('extracts 6-digit code from Spanish Airbnb email body', () => {
    const body = `
      Aquí tienes tu código de Airbnb
      515799
      Nunca compartas tu código de confirmación con nadie.
    `;

    expect(extractAirbnbOtp(body)).toBe('515799');
  });

  test('extracts code near keyword when multiple numbers exist', () => {
    const body = 'Your Airbnb code is 123456. Reference 202602.';
    expect(extractAirbnbOtp(body)).toBe('123456');
  });

  test('returns null when no code is present', () => {
    expect(extractAirbnbOtp('No verification code here')).toBeNull();
  });
});
