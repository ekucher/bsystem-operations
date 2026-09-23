import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 8080);
const app = createApp();

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`bsystem-operations-api listening on :${port}`);
});
