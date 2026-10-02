import { expect, type Locator, type Page } from '@playwright/test';

export async function expectModalFocus(page: Page, dialog: Locator): Promise<void> {
  const close = dialog.getByRole('button', { name: '닫기', exact: true });
  await expect(close).toBeEnabled();
  await expect(dialog.getByRole('heading')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  const background = page.locator('nav button').first();
  await background.evaluate((node) => node.focus());
  await expect(close).toBeFocused();
}
