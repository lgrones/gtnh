import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { join, relative } from 'node:path';

// Getting the Java onto disk.
//
// The tarball is fetched once into a gitignored cache and extracted with the
// system `tar`, not a hand-rolled reader: a 42 MB archive of 2800 files is
// exactly the kind of thing a shortcut gets subtly wrong, and `tar` is already
// installed everywhere this runs.
//
// The cache is keyed by version, so pointing the extractor at the next GTNH
// release downloads alongside the current one rather than over it, and a
// re-run against a version already on disk touches the network not at all.

export const CACHE_DIR = '.gt-cache';

const tarballUrl = (version: string) =>
  `https://codeload.github.com/GTNewHorizons/GT5-Unofficial/tar.gz/refs/tags/${version}`;

export interface Checkout {
  version: string;
  /** Directory holding `src/main/java` */
  root: string;
}

/**
 * The extracted source tree for one GT version, downloading it first if the
 * cache does not already have it.
 */
export const fetchSource = async (version: string): Promise<Checkout> => {
  const root = join(CACHE_DIR, `GT5-Unofficial-${version}`);
  if (existsSync(join(root, 'src', 'main', 'java'))) return { version, root };

  mkdirSync(CACHE_DIR, { recursive: true });
  const tarball = join(CACHE_DIR, `${version}.tar.gz`);

  if (!existsSync(tarball)) {
    const response = await fetch(tarballUrl(version));
    if (!response.ok)
      throw new Error(
        `GT ${version}: ${response.status} from ${tarballUrl(version)} — is that a real tag?`,
      );
    const { writeFileSync } = await import('node:fs');
    writeFileSync(tarball, Buffer.from(await response.arrayBuffer()));
  }

  execFileSync('tar', ['-xzf', tarball, '-C', CACHE_DIR]);
  if (!existsSync(join(root, 'src', 'main', 'java')))
    throw new Error(`${tarball} did not unpack to ${root}/src/main/java`);

  return { version, root };
};

export interface SourceFile {
  /** Path relative to the checkout root, as it would be quoted in a review */
  path: string;
  text: string;
}

/** Every `.java` file under `src/main/java`, read eagerly — it is 2834 files */
export const readJavaFiles = (checkout: Checkout): SourceFile[] => {
  const base = join(checkout.root, 'src', 'main', 'java');
  const files: SourceFile[] = [];

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.java'))
        files.push({
          path: relative(checkout.root, full),
          text: readFileSync(full, 'utf8'),
        });
    }
  };

  walk(base);
  return files.sort((a, b) => a.path.localeCompare(b.path));
};
