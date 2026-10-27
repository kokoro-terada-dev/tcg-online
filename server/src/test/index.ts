import { createTestServer } from "./server";

const { http } = createTestServer();
const port = Number(process.env.PORT ?? 3001);
http.listen(port, "0.0.0.0", () => console.log(`Test server listening on ${port}`));
