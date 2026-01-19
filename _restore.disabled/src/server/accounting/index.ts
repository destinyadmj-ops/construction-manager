import type { AccountingProvider, AccountingProviderKey } from './types';
import { JdlProvider } from './jdl';

export function getAccountingProvider(): AccountingProvider {
  const key = (process.env.ACCOUNTING_PROVIDER ?? 'jdl') as AccountingProviderKey;
  switch (key) {
    case 'jdl':
    default:
      return new JdlProvider();
  }
}
