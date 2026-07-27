#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

const SRC_FILES = [
  'background.js',
  'popup.html',
  'popup.js',
  'types.js',
  'permission-gate.js',
];

const ADAPTER_FILES = [
  'adapters/index.js',
  'adapters/generic.js',
  'adapters/github.js',
  'adapters/google.js',
  'adapters/notion.js',
  'adapters/slack.js',
  'adapters/docs.js',
];

const CONTENT_FILE = 'content.js';

const ROOT_FILES = ['manifest.json'];

const ICON_FILES = [
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
];

function rmrf(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function mkdirp(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyFile(src, dest) {
  mkdirp(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function build() {
  const watch = process.argv.includes('--watch');

  rmrf(DIST);
  mkdirp(DIST);
  mkdirp(path.join(DIST, 'icons'));

  for (const file of ROOT_FILES) {
    const src = path.join(ROOT, file);
    const dest = path.join(DIST, file);
    if (fs.existsSync(src)) {
      copyFile(src, dest);
      console.log(`  ${file}`);
    } else {
      console.warn(`  SKIP ${file} (not found)`);
    }
  }

  for (const file of SRC_FILES) {
    const src = path.join(SRC, file);
    const dest = path.join(DIST, file);
    if (fs.existsSync(src)) {
      copyFile(src, dest);
      console.log(`  src/${file}`);
    } else {
      console.warn(`  SKIP src/${file} (not found)`);
    }
  }

  for (const file of ADAPTER_FILES) {
    const src = path.join(SRC, file);
    const dest = path.join(DIST, file);
    if (fs.existsSync(src)) {
      copyFile(src, dest);
      console.log(`  src/${file}`);
    } else {
      console.warn(`  SKIP src/${file} (not found)`);
    }
  }

  const contentSrc = path.join(SRC, CONTENT_FILE);
  const contentDest = path.join(DIST, CONTENT_FILE);
  if (fs.existsSync(contentSrc)) {
    copyFile(contentSrc, contentDest);
    console.log(`  src/${CONTENT_FILE}`);
  } else {
    console.warn(`  SKIP src/${CONTENT_FILE} (not found)`);
  }

  for (const file of ICON_FILES) {
    const src = path.join(ROOT, file);
    const dest = path.join(DIST, file);
    if (fs.existsSync(src)) {
      copyFile(src, dest);
      console.log(`  ${file}`);
    } else {
      console.warn(`  SKIP ${file} (not found)`);
    }
  }

  console.log(`\nBuilt to ${DIST}`);

  if (watch) {
    console.log('Watching for changes...');
    const watchDirs = [SRC, ROOT];
    for (const dir of watchDirs) {
      if (fs.existsSync(dir)) {
        fs.watch(dir, { recursive: true }, (eventType, filename) => {
          if (!filename) return;
          console.log(`\nChanged: ${filename} — rebuilding...`);
          build();
        });
      }
    }
  }
}

build();
