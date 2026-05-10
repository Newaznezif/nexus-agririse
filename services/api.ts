export const fetchData = async (endpoint: string) => {
  console.log(`Fetching from ${endpoint}...`);
  return { data: 'Mock data from ' + endpoint };
};

export const postData = async (endpoint: string, payload: any) => {
  console.log(`Posting to ${endpoint}...`, payload);
  return { success: true };
};
