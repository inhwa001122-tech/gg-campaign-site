import { getStore } from '@netlify/blobs';
import seed from '../../content/site.json' with { type: 'json' };
import { createCampaignHandler, campaignStoreName } from '../../server/campaign.mjs';

// Preview changes must not write the production content stores on this same site.
export default (request, context) => createCampaignHandler({
  getStore: options => getStore({ ...options, name: campaignStoreName(options.name, context?.deploy) }), seed
})(request);
