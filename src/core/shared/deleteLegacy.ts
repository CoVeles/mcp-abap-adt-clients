/**
 * Legacy deletion for older SAP systems (BASIS < 7.50)
 *
 * Uses direct DELETE on the object URL with lockHandle,
 * instead of the modern /sap/bc/adt/deletion/check + /deletion/delete API.
 *
 * One request, the DELETE. The lock is the caller's, on both sides: take it
 * before and give it back after. Without a handle BASIS 7.40 answers `400`
 * "Parameter lockHandle could not be found"; and over RFC the lock outlives a
 * successful delete — a create of the same name straight after answers `403`
 * "User … is currently editing …" until the UNLOCK (measured on premise,
 * 2026-10-01). See ERRATA "On BASIS 7.40 a delete needs the caller's lock, and
 * keeps it".
 */

import type { IAbapConnection } from '@mcp-abap-adt/interfaces-adt-connection';
import { writeQuery } from '../../utils/internalUtils';
import { getTimeout } from '../../utils/timeouts';

/**
 * Delete an ADT object via direct DELETE request.
 * Requires a lock handle obtained from the object's lock function.
 *
 * @param connection - SAP connection
 * @param objectUrl - Full object URL (e.g. /sap/bc/adt/programs/programs/zmy_prog)
 * @param lockHandle - Lock handle from lock operation
 * @param transportRequest - Optional transport request number
 */
export async function deleteObjectDirect(
  connection: IAbapConnection,
  objectUrl: string,
  lockHandle: string | undefined,
  transportRequest?: string,
) {
  const url = `${objectUrl}${writeQuery(lockHandle, transportRequest?.trim())}`;

  return connection.makeAdtRequest({
    url,
    method: 'DELETE',
    timeout: getTimeout('default'),
    data: null,
  });
}
