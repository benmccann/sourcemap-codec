/* eslint-env node */

const { readdirSync, readFileSync } = require('fs');
const { dirname, join, relative } = require('path');
const Benchmark = require('benchmark');
const sourcemapCodec = require('../');
const originalSourcemapCodec = require('sourcemap-codec');
const sourceMap061 = require('source-map');
const sourceMapWasm = require('source-map-wasm');

const dir = relative(process.cwd(), __dirname);

console.log(`node ${process.version}\n`);

function track(label, results, cb) {
  if (global.gc) global.gc();
  const before = process.memoryUsage();
  const ret = cb();
  const after = process.memoryUsage();
  const d = delta(before, after);
  console.log(
    `${label.padEnd(30, ' ')} ${String(d.heapUsed + d.external).padStart(10, ' ')} bytes`,
  );
  results.push({ label, delta: d.heapUsed + d.external });
  return ret;
}

function delta(before, after) {
  return {
    rss: after.rss - before.rss,
    heapTotal: after.heapTotal - before.heapTotal,
    heapUsed: after.heapUsed - before.heapUsed,
    external: after.external - before.external,
    arrayBuffers: after.arrayBuffers - before.arrayBuffers,
  };
}

async function bench(file) {
  const map = JSON.parse(readFileSync(join(dir, file)));
  const encoded = map.mappings;
  const decoded = sourcemapCodec.decode(encoded);
  const consumer061 = new sourceMap061.SourceMapConsumer(map);
  const consumerWasm = await new sourceMapWasm.SourceMapConsumer(map);

  const segments = decoded.reduce((cur, line) => {
    return cur + line.length;
  }, 0);
  console.log(file, `- ${segments} segments`);
  console.log('');

  {
    console.log('Decode Memory Usage:');
    const results = [];
    track('@jridgewell/sourcemap-codec', results, () => {
      return sourcemapCodec.decode(encoded);
    });
    track('sourcemap-codec', results, () => {
      return originalSourcemapCodec.decode(encoded);
    });
    track('source-map-0.6.1', results, () => {
      consumer061._parseMappings(encoded, '');
      return consumer061;
    });
    track('source-map-0.8.0', results, () => {
      consumerWasm.destroy();
      consumerWasm._parseMappings(encoded, '');
      return consumerWasm;
    });
    const winner = results.reduce((min, cur) => {
      if (cur.delta < min.delta) return cur;
      return min;
    });
    console.log(`Smallest memory usage is ${winner.label}`);
  }

  console.log('');

  console.log('Decode speed:');
  new Benchmark.Suite()
    .add('decode: @jridgewell/sourcemap-codec', () => {
      sourcemapCodec.decode(encoded);
    })
    .add('decode: sourcemap-codec', () => {
      originalSourcemapCodec.decode(encoded);
    })
    .add('decode: source-map-0.6.1', () => {
      consumer061._parseMappings(encoded, '');
    })
    .add('decode: source-map-0.8.0', () => {
      consumerWasm.destroy();
      consumerWasm._parseMappings(encoded, '');
    })
    // add listeners
    .on('error', ({ error }) => console.error(error))
    .on('cycle', (event) => {
      console.log(String(event.target));
    })
    .on('complete', function () {
      console.log('Fastest is ' + this.filter('fastest').map('name'));
    })
    .run({});

  console.log('');

  const generator061 = sourceMap061.SourceMapGenerator.fromSourceMap(consumer061);
  const generatorWasm = sourceMapWasm.SourceMapGenerator.fromSourceMap(
    await new sourceMapWasm.SourceMapConsumer(map),
  );

  {
    console.log('Encode Memory Usage:');
    const results = [];
    track('@jridgewell/sourcemap-codec', results, () => {
      return sourcemapCodec.encode(decoded);
    });
    track('sourcemap-codec', results, () => {
      return originalSourcemapCodec.encode(decoded);
    });
    track('source-map-0.6.1', results, () => {
      return generator061._serializeMappings();
    });
    track('source-map-0.8.0', results, () => {
      return generatorWasm._serializeMappings();
    });
    const winner = results.reduce((min, cur) => {
      if (cur.delta < min.delta) return cur;
      return min;
    });
    console.log(`Smallest memory usage is ${winner.label}`);
  }

  console.log('');

  console.log('Encode speed:');
  new Benchmark.Suite()
    .add('encode: @jridgewell/sourcemap-codec', () => {
      sourcemapCodec.encode(decoded);
    })
    .add('encode: sourcemap-codec', () => {
      originalSourcemapCodec.encode(decoded);
    })
    .add('encode: source-map-0.6.1', () => {
      generator061._serializeMappings();
    })
    .add('encode: source-map-0.8.0', () => {
      generatorWasm._serializeMappings();
    })
    // add listeners
    .on('error', ({ error }) => console.error(error))
    .on('cycle', (event) => {
      console.log(String(event.target));
    })
    .on('complete', function () {
      console.log('Fastest is ' + this.filter('fastest').map('name'));
    })
    .run({});
}

(async () => {
  const files = readdirSync(dir);
  let first = true;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.endsWith('.map')) continue;

    if (!first) console.log('\n\n***\n\n');
    first = false;

    await bench(file);
  }
})();
