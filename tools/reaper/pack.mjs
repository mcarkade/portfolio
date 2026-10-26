// External dependencies: npm install --prefix C:/Abhinav/Projects/_scratch/reaper @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 @gltf-transform/functions@4.5.1 meshoptimizer@1.3.0 sharp gltf-validator
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
const scratch = 'C:/Abhinav/Projects/_scratch/reaper';
const requireScratch = createRequire(`${scratch}/package.json`);
const external = async (name) => import(pathToFileURL(requireScratch.resolve(name)).href);
const { NodeIO } = await external('@gltf-transform/core');
const { ALL_EXTENSIONS } = await external('@gltf-transform/extensions');
const { weld, simplify, meshopt } = await external('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } = await external('meshoptimizer');
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});
const doc = await io.read(`${scratch}/reaper-raw.glb`);
const count = () => doc.getRoot().listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((s,p) => s + p.getIndices().getCount()/3,0),0);
const before = count();
await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: .15, error: .0005, lockBorder: true }));
const after = count();
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
await mkdir(new URL('../../public/models/', import.meta.url), { recursive: true });
const output = new URL('../../public/models/reaper.glb', import.meta.url);
const bytes = await io.writeBinary(doc);
if (bytes.length > 1500000) throw new Error(`GLB exceeds budget: ${bytes.length} bytes`);
const validator = (await external('gltf-validator')).default;
const validation = await validator.validateBytes(bytes, { maxIssues: 30 });
// The official validator does not decode EXT_meshopt_compression. The renderer
// independently checks every decoded normal and mesh with the site's decoder.
if (validation.issues.numErrors) throw new Error(JSON.stringify(validation.issues));
await writeFile(output, bytes);
await writeFile(`${scratch}/packing.json`, JSON.stringify({ before, after, bytes: bytes.length, validation }, null, 2));
console.log(JSON.stringify({ before, after, bytes: bytes.length, validation: validation.issues, output: output.pathname }));
