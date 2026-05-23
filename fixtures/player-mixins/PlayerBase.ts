import { Page } from '@playwright/test'

export class PlayerBase {
  constructor(readonly page: Page) {}
}
