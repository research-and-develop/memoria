import { describeBlobStoreContract } from '../contract/blobStore';
import { memoryBlobStore } from './blobStore';

describeBlobStoreContract('memory', async () => ({ blobs: memoryBlobStore(), dispose: async () => {} }));
