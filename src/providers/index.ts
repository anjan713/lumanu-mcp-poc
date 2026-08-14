/**
 * Choosing which `LumanuProvider` to run against.
 *
 * By configuration, never by code change — that is what makes the swap a
 * deployment decision rather than a release. `LUMANU_PROVIDER=mock` runs
 * against Supabase through Hasura; `LUMANU_PROVIDER=real` will run against
 * Lumanu's REST API once credentials exist.
 *
 * Nothing above this function names an implementation. Tools and domain
 * services are handed a `LumanuProvider` and cannot tell which one they hold.
 */

import { loadHasuraConfig, type AppConfig } from '@/config';

import type { LumanuProvider } from './lumanu-provider';
import { MockLumanuProvider } from './mock';

export * from './lumanu-provider';
// Lumanu's wire vocabulary. Re-exported here so a domain service or a tool
// names its types from the provider boundary rather than reaching past it.
export * from './wire';
export { US_CENTS } from './to-wire';
export { InMemoryLumanuProvider } from './in-memory';
export { MockLumanuProvider } from './mock';

/**
 * Built once per Lambda container rather than once per request, so a warm
 * container reuses the HTTP connection to Hasura. The provider holds no
 * per-request state, which is what makes that safe — see the stateless
 * transport note in docs/07.
 */
export function createProvider(config: AppConfig): LumanuProvider {
  switch (config.provider) {
    case 'mock':
      // Read here rather than at startup, so a server running against `real`
      // never needs Hasura credentials. Deliberately `loadHasuraConfig` and not
      // `loadDataLayerConfig`: this provider speaks GraphQL, so the deployed
      // function must not demand a database connection string it never opens.
      return new MockLumanuProvider(loadHasuraConfig());
    case 'real':
      throw new Error(
        'LUMANU_PROVIDER=real is not yet implemented. RealLumanuProvider arrives in ticket 08, ' +
          'and stays unexercised until Lumanu sandbox credentials are available.',
      );
  }
}
