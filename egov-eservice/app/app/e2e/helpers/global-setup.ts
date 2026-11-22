import { ensureTestFiles } from './files';

export default async function globalSetup(): Promise<void> {
  ensureTestFiles();
}
