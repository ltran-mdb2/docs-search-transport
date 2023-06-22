import { strictEqual, deepStrictEqual, ok, deepEqual } from 'assert';
import * as sinon from 'sinon';
import { parse } from 'toml';
import * as urllib from 'urllib';
import { AtlasAdminManager, _getFacetKeys } from '../..//src/AtlasAdmin';
import { Taxonomy } from '../../src/SearchIndex';

describe('Atlas Admin Manager', () => {
  // TODO: stub the urllib calls with sinon and add expected url/requestOptions
  describe('patchSearchIndex', () => {
    const pubKey = process.env.ATLAS_ADMIN_PUB_KEY || '',
      privKey = process.env.ATLAS_ADMIN_API_KEY || '',
      groupId = process.env.GROUP_ID || '',
      dbName = process.env.ATLAS_DATABASE || '',
      collection = process.env.COLLECTION_NAME || '',
      clusterName = process.env['CLUSTER_NAME'] || 'Search';

    const atlasAdmin = new AtlasAdminManager(pubKey, privKey, groupId);
    const taxonomy: Taxonomy = {};

    let urllibStub: sinon.SinonStub;
    beforeEach((done) => {
      // create mock for url lib
      urllibStub = sinon.stub(urllib, 'request');
      done();
    });
    afterEach((done) => {
      // reset mock for url lib
      urllibStub.restore();
      done();
    });

    const defaultOptions: urllib.RequestOptions = {
      headers: {
        'content-type': 'application/json',
      },
      dataType: 'json',
      digestAuth: `${pubKey}:${privKey}`,
    };
    const expectedUrl = `https://cloud.mongodb.com/api/atlas/v1.0/groups/${groupId}/clusters/${clusterName}/fts/indexes`;

    it('makes a digest auth request to find Search Index', async () => {
      urllibStub.onCall(0).resolves({ data: [], res: { statusCode: 200 } });
      urllibStub.onCall(1).resolves({ data: [], res: { statusCode: 200 } });
      const expectedOptions: urllib.RequestOptions = { ...defaultOptions };
      expectedOptions['method'] = 'GET';
      const url = `${expectedUrl}/${dbName}/${collection}`;
      await atlasAdmin.patchSearchIndex(taxonomy);
      sinon.assert.calledWith(urllibStub.firstCall, url, expectedOptions);
    });

    it('makes a request to create search index if not found', async () => {
      urllibStub.onCall(0).resolves({ data: [], res: { statusCode: 200 } });
      urllibStub.onCall(1).resolves({ data: [], res: { statusCode: 200 } });
      await atlasAdmin.patchSearchIndex(taxonomy);
      strictEqual(urllibStub.secondCall.args[0], expectedUrl);
      strictEqual(urllibStub.secondCall.args[1].method, 'POST');
    });

    it('makes a request to update search index if found', async () => {
      const expectedId = 'test-id';
      urllibStub.onCall(0).resolves({
        data: [
          {
            name: 'default',
            indexID: expectedId,
          },
        ],
        res: { statusCode: 200 },
      });
      urllibStub.onCall(1).resolves({ data: [], res: { statusCode: 200 } });
      await atlasAdmin.patchSearchIndex(taxonomy);
      strictEqual(urllibStub.secondCall.args[0], `${expectedUrl}/${expectedId}`);
      strictEqual(urllibStub.secondCall.args[1].method, 'PATCH');
    });
  });

  describe('_getFacetKeys', () => {
    it('converts a Taxonomy object to a list of strings with encodings', async () => {
      const sample = `
      name = "Taxonomy"
    
      [[genres]]
      name = "genre1"
    
      [[genres]]
      name = "genre2"
    
      [[target_platforms]]
      name = "platform1"
      [[target_platforms.versions]]
      name = "v1"
      [[target_platforms.versions]]
      name = "v2"
    
      [[target_platforms]]
      name = "platform2"
      [[target_platforms.versions]]
      name = "v1"
      [[target_platforms.versions]]
      name = "v2"
      `;

      const res = _getFacetKeys(parse(sample) as Taxonomy);
      const expected = [
        'genres',
        'target_platforms←platform1→versions',
        'target_platforms←platform2→versions',
        'target_platforms',
      ];
      deepEqual(res, expected);
    });
  });
});