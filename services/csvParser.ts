import Papa from 'papaparse';

export const parseCSV = (file: File): Promise<{ data: any[] | null; error: string | null; columns: string[] }> => {
  return new Promise((resolve) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors && results.errors.length > 0) {
          // If there are errors, we check if we still got data. Sometimes PapaParse recovers.
          // But for strictness, we can return the first error.
          resolve({
            data: null,
            error: results.errors[0].message,
            columns: []
          });
        } else {
          resolve({
            data: results.data,
            error: null,
            columns: results.meta.fields || []
          });
        }
      },
      error: (error) => {
        resolve({
          data: null,
          error: error.message,
          columns: []
        });
      }
    });
  });
};
