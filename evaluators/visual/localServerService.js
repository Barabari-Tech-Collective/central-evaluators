import http from "http";
import handler from "serve-handler";

export async function startStaticServer(
  rootPath
) {
  return new Promise((resolve, reject) => {

    const server = http.createServer(
      (req, res) => {
        return handler(req, res, {
          public: rootPath
        });
      }
    );

    server.listen(0, () => {

      const port =
        server.address().port;

      resolve({
        server,
        url:
          `http://127.0.0.1:${port}`
      });
    });

    server.on(
      "error",
      reject
    );
  });
}