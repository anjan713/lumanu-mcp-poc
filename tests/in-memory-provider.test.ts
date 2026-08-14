import { InMemoryLumanuProvider } from '@/providers/in-memory';
import { LumanuNotFoundError } from '@/providers/lumanu-provider';
import { CANONICAL, IDS } from '@/seed/canonical';

import { describeLumanuProviderContract } from './support/provider-contract';

describeLumanuProviderContract('InMemoryLumanuProvider', {
  create: () => new InMemoryLumanuProvider(),
  knownWorkspaceId: CANONICAL.workspace.id,
  knownProjectId: CANONICAL.project.id,
  knownPartnerId: IDS.maya,
  knownPayableId: IDS.mayaPayable,
});

describe('InMemoryLumanuProvider specifics', () => {
  it('serves the canonical Workspace by default', async () => {
    const { data, total } = await new InMemoryLumanuProvider().listWorkspaces();

    expect(total).toBe(1);
    expect(data?.[0]?.display_name).toBe('Acme US');
  });

  it('names the resource and the id when one is not found', async () => {
    const provider = new InMemoryLumanuProvider();

    await expect(provider.getWorkspace('missing')).rejects.toThrow(LumanuNotFoundError);
    await expect(provider.getWorkspace('missing')).rejects.toThrow(/Workspace.*missing/);
  });

  it('pages through a longer list when one is supplied', async () => {
    const many = Array.from({ length: 5 }, (_, index) => ({
      ...CANONICAL.workspace,
      id: `9f8b1c34-0000-4000-8000-00000000010${index}`,
    }));
    const provider = new InMemoryLumanuProvider({ workspaces: many });

    const page = await provider.listWorkspaces({ limit: 2, offset: 2 });
    expect(page.total).toBe(5);
    expect(page.data?.map((row) => row.id)).toEqual([many[2]?.id, many[3]?.id]);
  });

  it('reports an empty list without inventing an envelope', async () => {
    const result = await new InMemoryLumanuProvider({ workspaces: [] }).listWorkspaces();

    expect(result).toEqual({ data: [], total: 0, limit: 25, offset: 0 });
  });
});
