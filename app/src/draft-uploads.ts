import { useEffect, useRef } from 'react';
import { api, holdUpload, releaseUploads } from './api';

/**
 * Photos a form uploads before it is saved, thrown away if it never is.
 *
 * Uploading through this instead of `api.uploadPhoto` is all a form has to do.
 * Saving is noticed for it: any write that names the photo (see `noteSaved` in
 * api.ts) marks it kept. Whatever is still unsaved when the form goes - closed,
 * cancelled, navigated away from - is deleted from storage. A tab closed
 * outright never gets that far; the daily unused-photo sweep on the server
 * collects those.
 */
export function useDraftUploads() {
  const owner = useRef<symbol>(Symbol('draft-uploads'));

  useEffect(() => {
    const me = owner.current;
    return () => {
      for (const url of releaseUploads(me)) void api.discardPhoto(url);
    };
  }, []);

  return {
    /** Upload, and hold the photo as unsaved. */
    async upload(dataUrl: string) {
      const stored = await api.uploadPhoto(dataUrl);
      holdUpload(stored.url, owner.current);
      return stored;
    },
    /** A photo taken out again before saving: deleted now. */
    discard(url: string) {
      releaseUploads(owner.current, url);
      void api.discardPhoto(url);
    },
  };
}
