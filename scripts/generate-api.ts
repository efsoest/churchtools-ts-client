const inputSpecPath = 'swagger.json';
const outputDir = 'src/generated/openapi';

const command = [
  'bunx',
  '@openapitools/openapi-generator-cli',
  'generate',
  '-g',
  'typescript-fetch',
  '-i',
  inputSpecPath,
  '-o',
  outputDir,
  '--generate-alias-as-model',
  '--global-property=apiDocs=false,modelDocs=false,apiTests=false,modelTests=false',
  '--additional-properties=typescriptThreePlus=true,useSingleRequestParameter=true,supportsES6=true',
];

const result = Bun.spawn(command, {
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});

const exitCode = await result.exited;
if (exitCode !== 0) {
  process.exit(exitCode);
}
