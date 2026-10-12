import { createAdapterFactory } from "better-auth/adapters";

export interface SuiteDbConnection {
  /** The node's loopback internal API, for example `http://127.0.0.1:41234`. */
  url: string | (() => string);
  token: string;
}

/** A better-auth adapter that stores everything in SuiteDB through the
 * local node, so accounts and sessions replicate to every node. */
export function suitedbAdapter(connection: SuiteDbConnection) {
  const call = async <T>(body: Record<string, unknown>): Promise<T> => {
    const base =
      typeof connection.url === "function" ? connection.url() : connection.url;
    const response = await fetch(`${base}/internal/db`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-suiteleaf-internal": connection.token,
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      result?: T;
      error?: string;
    };
    if (!response.ok)
      throw new Error(
        `SuiteDB ${String(body.op)} ${String(body.model)}: ${payload.error ?? response.statusText}`,
      );
    return payload.result as T;
  };
  return createAdapterFactory({
    config: {
      adapterId: "suitedb",
      adapterName: "SuiteDB",
      supportsBooleans: false,
      supportsDates: false,
      supportsJSON: false,
      supportsArrays: false,
      supportsNumericIds: false,
      transaction: false,
    },
    adapter: ({ getFieldName, getDefaultModelName }) => {
      // `select` arrives with schema field names; the node filters on
      // physical column names, which a custom `fieldName` may change.
      const columns = (model: string, select?: string[]) =>
        select?.map((field) =>
          getFieldName({ model: getDefaultModelName(model), field }),
        );
      return {
        create: ({ model, data, select }) =>
          call({ op: "create", model, data, select: columns(model, select) }),
        findOne: ({ model, where, select }) =>
          call({ op: "findOne", model, where, select: columns(model, select) }),
        findMany: ({ model, where, limit, offset, sortBy, select }) =>
          call({
            op: "findMany",
            model,
            where,
            limit,
            offset,
            sortBy,
            select: columns(model, select),
          }),
        count: ({ model, where }) => call({ op: "count", model, where }),
        update: ({ model, where, update }) =>
          call({ op: "update", model, where, update }),
        updateMany: ({ model, where, update }) =>
          call({ op: "updateMany", model, where, update }),
        delete: async ({ model, where }) => {
          await call({ op: "delete", model, where });
        },
        deleteMany: ({ model, where }) =>
          call({ op: "deleteMany", model, where }),
      };
    },
  });
}
