/**
 * Activation Utilities - Centralized ABAP Object Activation Functions
 *
 * Two types of activation endpoints:
 * 1. Individual activation: /sap/bc/adt/activation (for single object in session)
 * 2. Group activation: /sap/bc/adt/activation/runs (for multiple objects)
 */

import type {
  IAbapConnection,
  IAdtWireResponse,
} from '@mcp-abap-adt/interfaces-adt-connection';
import { CT_ACTIVATION } from '../constants/contentTypes';
import { getEnhancementUri } from '../core/enhancement/types';
import {
  ACCESS_CONTROL,
  CLASS,
  DDIC_VIEW,
  DDL_SOURCE,
  FUNCTION_GROUP,
  FUNCTION_INCLUDE,
  FUNCTION_MODULE,
  INTERFACE,
  METADATA_EXTENSION,
  PACKAGE,
  PROGRAM,
  PROGRAM_INCLUDE,
  STRUCTURE,
  TABLE,
  TABLE_TYPE,
} from '../endpoints/objects';
import { encodeSapObjectName } from './internalUtils';
import { getTimeout } from './timeouts';

/**
 * Build object URI from name and type
 * Used by both individual and group activation
 *
 * @param name - Object name (e.g., 'ZCL_MY_CLASS', 'Z_MY_PROGRAM')
 * @param type - Object type code (e.g., 'CLAS/OC', 'PROG/P', 'DDLS/DF')
 * @param parentName - Parent object name (e.g., function group name for FUGR/FF)
 * @returns ADT URI for the object
 */
export function buildObjectUri(
  name: string,
  type?: string,
  parentName?: string,
): string {
  const lowerName = encodeSapObjectName(name).toLowerCase();

  if (!type) {
    // Try to guess type from name prefix
    if (name.startsWith('ZCL_') || name.startsWith('CL_')) {
      return `${CLASS.uri(name)}`;
    } else if (name.startsWith('Z') && name.includes('_PROGRAM')) {
      return `${PROGRAM.uri(name)}`;
    }
    // Default: assume program
    return `${PROGRAM.uri(name)}`;
  }

  // Map type to URI path
  switch (type.toUpperCase()) {
    // A package is not `/sap/bc/adt/devc/k/…`, which is what the fallback at the
    // bottom of this switch builds from the type code. ADT answers that address
    // with `No URI-Mapping defined for URI`, and every group operation —
    // deletion check, delete, activate — was asking about packages there.
    // `AdtPackage` has always used the right resource directly, which is why
    // package CRUD worked while the group operations did not.
    case 'DEVC/K':
    case 'DEVC':
      return `${PACKAGE.uri(name)}`;

    case 'CLAS/OC':
    case 'CLAS':
      return `${CLASS.uri(name)}`;

    case 'PROG/P':
    case 'PROG':
      return `${PROGRAM.uri(name)}`;

    case 'PROG/I':
      return `${PROGRAM_INCLUDE.uri(name)}`;

    case 'FUGR/FF': {
      if (parentName) {
        return `${FUNCTION_MODULE.uri(parentName, name)}`;
      }
      return `${FUNCTION_MODULE.uri(name, name)}`;
    }

    case 'FUGR/I': {
      // A function include lives under its group, and the address is
      // meaningless without it: `/functions/groups/<group>/includes/<NAME>`,
      // with the include's name upper-cased the way its own activation sends
      // it. The group is the caller's to give — it is their argument that is
      // missing, not anything SAP said, so it is thrown.
      if (!parentName) {
        throw new Error(
          `A function include (FUGR/I) is addressed under its function group; pass the group as parentName for ${name}`,
        );
      }
      return `${FUNCTION_INCLUDE.uri(parentName, name)}`;
    }

    case 'FUGR':
    case 'FUGR/F':
    case 'FUNC':
      return `${FUNCTION_GROUP.uri(name)}`;

    case 'TABL/DT':
    case 'TABL':
      return `${TABLE.uri(name)}`;

    case 'TABL/DS':
    case 'STRU/DS':
    case 'STRU':
      return `${STRUCTURE.uri(name)}`;

    case 'DDLS/DF':
    case 'DDLS':
      return `${DDL_SOURCE.uri(name)}`;

    case 'VIEW/DV':
    case 'VIEW':
      return `${DDIC_VIEW.uri(name)}`;

    case 'DTEL/DE':
    case 'DTEL':
      return `/sap/bc/adt/ddic/dataelements/${lowerName}`;

    case 'DOMA/DD':
    case 'DOMA':
      return `/sap/bc/adt/ddic/domains/${lowerName}`;

    case 'INTF/OI':
    case 'INTF':
      return `${INTERFACE.uri(name)}`;

    case 'TTYP/DF':
    case 'TTYP/TT':
    case 'TTYP':
      return `${TABLE_TYPE.uri(name)}`;

    case 'SRVD/SRV':
    case 'SRVD':
      return `/sap/bc/adt/ddic/srvd/sources/${lowerName}`;

    case 'SRVB/SVB':
    case 'SRVB':
      return `/sap/bc/adt/businessservices/bindings/${lowerName}`;

    case 'DDLX/EX':
    case 'DDLX':
      return `${METADATA_EXTENSION.uri(name)}`;

    case 'BDEF/BDO':
    case 'BDEF':
      // `/bo/behaviordefinitions`, as a BDEF's own activation and the
      // inactive-objects list both address it. This read `/ddic/bdef/sources`
      // until #173: SAP resolved that to nothing and answered
      // `activationExecuted="false"` with no message, so a group activation
      // reported success and left the behavior definition inactive.
      return `/sap/bc/adt/bo/behaviordefinitions/${lowerName}`;

    case 'DCLS/DL':
    case 'DCLS':
      return `${ACCESS_CONTROL.uri(name)}`;

    case 'DSFD/SCF':
      return `/sap/bc/adt/ddic/dsfd/sources/${lowerName}`;

    case 'DSFI/SFI':
      return `/sap/bc/adt/ddic/dsfi/${lowerName}`;

    case 'ENHO/ENH':
    case 'XSLT/VT':
    case 'XSLT':
      return `/sap/bc/adt/xslt/transformations/${lowerName}`;

    case 'AUTH':
      return `/sap/bc/adt/aps/iam/auth/${lowerName}`;

    case 'FTG2/FT':
    case 'FTG2':
      return `/sap/bc/adt/sfw/featuretoggles/${lowerName}`;

    // The subtype is a path segment — `/enhancements/enhoxh/<name>` — so it is
    // read off the type code, and built by the same function the enhancement's
    // own activation uses. This case built `/enhancements/<name>` until #173's
    // check found it, and the subtyped codes fell through to `default`.
    case 'ENHO/EXH':
      return getEnhancementUri('enhoxh', lowerName);
    case 'ENHO/EXHB':
      return getEnhancementUri('enhoxhb', lowerName);
    case 'ENHO/EXHH':
      return getEnhancementUri('enhoxhh', lowerName);
    case 'ENHS/EXS':
      return getEnhancementUri('enhsxs', lowerName);
    case 'ENHS/EXSB':
      return getEnhancementUri('enhsxsb', lowerName);

    case 'ENHO':
    case 'ENHS':
      // Which subtype is the caller's to say; guessing one is the `default`
      // branch's mistake below. Their argument is short, not SAP's answer.
      throw new Error(
        `${type} does not say which enhancement subtype ${name} is, and the subtype is part of its address; pass the full type (e.g. ENHO/EXH, ENHO/EXHB, ENHO/EXHH, ENHS/EXS, ENHS/EXSB)`,
      );

    default:
      // A guess dressed as a mapping: right when the ADT path happens to be the
      // lowercased type code, silent when it is not. `DEVC/K` is the case that
      // showed it — the address it built exists nowhere, and ADT's complaint
      // arrived inside a 200 where nothing was reading it.
      //
      // Left in place rather than made to throw: the types above are mapped, and
      // the ones that are not are reached by callers passing a type this library
      // never claimed to know. Making that a throw is a separate decision about
      // how strict `IObjectReference` should be.
      return `/sap/bc/adt/${type.toLowerCase()}/${lowerName}`;
  }
}

/**
 * Individual object activation (within a session)
 * Used by Update/Create handlers after lock/unlock operations
 *
 * @param connection - ABAP connection instance
 * @param objectUri - ADT URI of the object (e.g., '/sap/bc/adt/oo/classes/zcl_test')
 * @param objectName - Object name in uppercase (e.g., 'ZCL_TEST')
 * @param sessionId - Session ID for stateful operations
 * @param preaudit - Request pre-audit before activation (default: true)
 * @returns Axios response with activation result
 */
export async function activateObjectInSession(
  connection: IAbapConnection,
  objectUri: string,
  objectName: string,
  preaudit: boolean = true,
): Promise<IAdtWireResponse> {
  const url = `/sap/bc/adt/activation?method=activate&preauditRequested=${preaudit}`;

  const activationXml = `<?xml version="1.0" encoding="UTF-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="${objectUri}" adtcore:name="${objectName}"/>
</adtcore:objectReferences>`;

  const headers = {
    'Content-Type': CT_ACTIVATION,
    Accept: 'application/xml',
  };

  const response = await connection.makeAdtRequest({
    url,
    method: 'POST',
    timeout: getTimeout('default'),
    data: activationXml,
    headers,
  });

  // The answer, as it arrived. ADT returns 200 even on a failed activation
  // (locked object, syntax errors), so the status does not carry the verdict
  // and neither does this function. Whether a checklist body means the
  // activation happened is read by the caller's own `analyse`.
  return response;
}
