import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { ClassSectionProxy } from "../src/controllers/classSection";

const httpTrigger: AzureFunction = async function (
  context: Context,
  req: HttpRequest
): Promise<void> {
  // Wrap Express controller for Azure Function
  const mockRes = {
    status: (code: number) => ({
      json: (data: any) => {
        context.res = {
          status: code,
          headers: { 'Content-Type': 'application/json' },
          body: data
        };
      },
      send: (data: any) => {
        context.res = {
          status: code,
          headers: { 'Content-Type': 'application/json' },
          body: data
        };
      }
    }),
    json: (data: any) => {
      context.res = {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'max-age=300'
        },
        body: data
      };
    },
    setHeader: (key: string, value: string) => {
      // Headers are set in the json/send methods above
    }
  };

  await ClassSectionProxy(
    { query: req.query } as any,
    mockRes as any
  );
};

export default httpTrigger;
