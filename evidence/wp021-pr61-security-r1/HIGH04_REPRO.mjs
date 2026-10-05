// Security reviewer reproduction. Node >=24 type stripping.
// Use xml-validator.ts and errors.ts from subject 043673f5b01dbbf36602060ba4428f059b024769.
// In isolated copy only, change import './errors.js' to './errors.ts'.
import {parseXmlStructure, validateAndExtractTimbreFiscalDigital as v} from './xml-validator.ts';
const root='<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0">';
const tfd='<tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="12345678-1234-4123-a123-123456789abc" FechaTimbrado="2026-10-05T10:00:00" RfcProvCertif="AAA010101AAA" SelloSAT="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" NoCertificadoSAT="12345678901234567890"/>';
const original=root+'</cfdi:Comprobante>';
for(const [name,xml] of [
 ['control',root+'<cfdi:Complemento>'+tfd+'</cfdi:Complemento></cfdi:Comprobante>'],
 ['malformed_certified',root.replace('<cfdi:','< cfdi:')+'<cfdi:Complemento>'+tfd+'</cfdi:Complemento></cfdi:Comprobante>']
]) {
 try {v(xml,{expectedOriginalXml:original});console.log(name,'ACCEPTED');}
 catch(e){console.log(name,'REJECTED',e.message);}
}
for(const xml of ['<Root a="&#0;"/>','< Root/>']){
 try{parseXmlStructure(xml);console.log('malformed_input',xml,'ACCEPTED');}
 catch(e){console.log('malformed_input',xml,'REJECTED',e.message);}
}
const before=root+'<cfdi:Complemento><p:Data xmlns:p="urn:example">before<p:Child/>after</p:Data></cfdi:Complemento></cfdi:Comprobante>';
const after=root+'<cfdi:Complemento><p:Data xmlns:p="urn:example">before after<p:Child/></p:Data>'+tfd+'</cfdi:Complemento></cfdi:Comprobante>';
try{v(after,{expectedOriginalXml:before});console.log('mixed_content_relocation ACCEPTED');}
catch(e){console.log('mixed_content_relocation REJECTED',e.message);}
