import type { JsonValue } from "../shared/types.js";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, JsonValue>;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, JsonValue>;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: JsonValue;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: number;
  result: JsonValue;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: number;
  error: JsonRpcErrorObject;
}

export type JsonRpcInbound =
  | JsonRpcSuccessResponse
  | JsonRpcErrorResponse
  | JsonRpcNotification;

export class JsonRpcRequestError extends Error {
  public readonly code: number;

  public readonly data: JsonValue | undefined;

  public constructor(message: string, code: number, data?: JsonValue) {
    super(message);
    this.name = "JsonRpcRequestError";
    this.code = code;
    this.data = data;
  }
}
