let _queryLog = [];
let _listeners = [];

function notifyListeners() {
  _listeners.forEach(fn => fn([..._queryLog]));
}

export function subscribeToQueryLog(listener) {
  _listeners.push(listener);
  return () => {
    _listeners = _listeners.filter(fn => fn !== listener);
  };
}

export function getQueryLog() {
  return [..._queryLog];
}

export function clearQueryLog() {
  _queryLog = [];
  notifyListeners();
}

export function addLogEntry(entry) {
  _queryLog.push(entry);
  notifyListeners();
}

export async function fhirFetch(baseUrl, path, { authToken, accept, responseType } = {}) {
  const url = `${baseUrl}${path}`;
  const entry = {
    timestamp: new Date().toISOString(),
    method: 'GET',
    url,
    status: 'pending',
    error: null,
  };
  addLogEntry(entry);

  const headers = {};
  if (accept) {
    headers['Accept'] = accept;
  } else {
    headers['Accept'] = 'application/fhir+json';
  }
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  try {
    const response = await fetch(url, { headers });
    entry.status = response.status;
    notifyListeners();

    if (!response.ok) {
      const text = await response.text();
      entry.error = text;
      notifyListeners();
      throw new Error(`FHIR request failed: ${response.status} ${text}`);
    }

    if (responseType === 'arraybuffer') {
      return response.arrayBuffer();
    }
    return response.json();
  } catch (error) {
    if (entry.status === 'pending') {
      entry.status = 'error';
    }
    entry.error = error.message;
    notifyListeners();
    throw error;
  }
}

export function fetchPatient(baseUrl, patientId, opts = {}) {
  return fhirFetch(baseUrl, `/Patient/${patientId}`, opts);
}

export function fetchImagingStudies(baseUrl, patientId, opts = {}) {
  return fhirFetch(baseUrl, `/ImagingStudy?patient=${patientId}`, opts);
}

export function fetchImagingStudyById(baseUrl, imagingStudyId, opts = {}) {
  return fhirFetch(baseUrl, `/ImagingStudy/${imagingStudyId}`, opts);
}

export function fetchDocumentReferences(baseUrl, { patientId, imagingStudyId } = {}, opts = {}) {
  let path = `/DocumentReference?patient=${patientId}&type=http://loinc.org|18748-4`;
  if (imagingStudyId) {
    path += `&related=ImagingStudy/${imagingStudyId}`;
  }
  return fhirFetch(baseUrl, path, opts);
}

export async function fhirPost(baseUrl, path, body, { authToken } = {}) {
  const url = `${baseUrl}${path}`;
  const entry = {
    timestamp: new Date().toISOString(),
    method: 'POST',
    url,
    status: 'pending',
    error: null,
  };
  addLogEntry(entry);

  const headers = {
    'Content-Type': 'application/fhir+json',
    'Accept': 'application/fhir+json',
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  try {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    entry.status = response.status;
    notifyListeners();
    if (!response.ok) {
      const text = await response.text();
      entry.error = text;
      notifyListeners();
      throw new Error(`FHIR POST failed: ${response.status} ${text}`);
    }
    return response.json();
  } catch (error) {
    if (entry.status === 'pending') entry.status = 'error';
    entry.error = error.message;
    notifyListeners();
    throw error;
  }
}

export function createDocumentReference(baseUrl, resource, opts = {}) {
  return fhirPost(baseUrl, '/DocumentReference', resource, opts);
}

export function fetchDicomFile(serverRoot, fileUrl, opts = {}) {
  const url = fileUrl.startsWith('http') ? fileUrl : `${serverRoot}${fileUrl}`;

  const entry = {
    timestamp: new Date().toISOString(),
    method: 'GET',
    url,
    status: 'pending',
    error: null,
  };
  addLogEntry(entry);

  const headers = {};
  if (opts.authToken) {
    headers['Authorization'] = `Bearer ${opts.authToken}`;
  }

  return fetch(url, { headers })
    .then(response => {
      entry.status = response.status;
      notifyListeners();
      if (!response.ok) {
        throw new Error(`DICOM fetch failed: ${response.status}`);
      }
      return response.arrayBuffer();
    })
    .catch(error => {
      if (entry.status === 'pending') {
        entry.status = 'error';
      }
      entry.error = error.message;
      notifyListeners();
      throw error;
    });
}
