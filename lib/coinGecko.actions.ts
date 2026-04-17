"use server";

import qs from "query-string";

const PRO_API_HOST = "pro-api.coingecko.com";
const DEMO_BASE_URL = "https://api.coingecko.com/api/v3";

const getRequiredEnv = (name: "COINGECKO_BASE_URL" | "COINGECKO_API_KEY"): string => {
	const value = process.env[name];

	if (!value) {
		throw new Error(`Could not get ${name.toLowerCase()}`);
	}

	return value;
};

const BASE_URL = getRequiredEnv("COINGECKO_BASE_URL");
const API_KEY = getRequiredEnv("COINGECKO_API_KEY");

const normalizeBaseUrl = (url: string) => url.replace(/\/+$/, "");
const normalizeEndpoint = (endpoint: string) => endpoint.replace(/^\/+/, "");

const buildHeaders = (baseUrl: string): Record<string, string> => {
	const useProHeader = baseUrl.includes(PRO_API_HOST);

	return {
		[useProHeader ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]: API_KEY,
		"Content-Type": "application/json",
	};
};

const buildUrl = (baseUrl: string, endpoint: string, params?: QueryParams) =>
	qs.stringifyUrl(
		{
			url: `${normalizeBaseUrl(baseUrl)}/${normalizeEndpoint(endpoint)}`,
			query: params,
		},
		{ skipEmptyString: true, skipNull: true },
	);

const stripIntervalParam = (query?: QueryParams): QueryParams | undefined => {
	if (!query || !("interval" in query)) return query;

	const { interval: _interval, ...withoutInterval } = query;
	return withoutInterval;
};

const replaceMaxDaysWithYear = (query?: QueryParams): QueryParams | undefined => {
	if (!query || query.days !== "max") return query;

	return {
		...query,
		days: 365,
	};
};

export async function fetcher<T>(
	endpoint: string,
	params?: QueryParams,
	revalidate = 60,
): Promise<T> {
	const request = (baseUrl: string, query?: QueryParams) =>
		fetch(buildUrl(baseUrl, endpoint, query), {
			headers: buildHeaders(baseUrl),
			next: { revalidate },
		});

	const readError = async (response: Response) => {
		const errorBody = (await response.json().catch(() => ({}))) as CoinGeckoErrorBody & {
			status?: unknown;
		};

		const details = errorBody.error ?? errorBody.status;

		if (typeof details === "string") return details;
		if (details && typeof details === "object") return JSON.stringify(details);

		return response.statusText;
	};

	const cleanEndpoint = normalizeEndpoint(endpoint);
	const isOhlcEndpoint = cleanEndpoint.endsWith("/ohlc") || cleanEndpoint.includes("/ohlc?");
	const hasIntervalParam = Boolean(params && "interval" in params);
	const hasMaxDaysParam = params?.days === "max";

	let response = await request(BASE_URL, params);

	if (response.ok) {
		return response.json();
	}

	if (isOhlcEndpoint && hasIntervalParam) {
		const paramsWithoutInterval = stripIntervalParam(params);
		const retryWithoutInterval = await request(BASE_URL, paramsWithoutInterval);

		if (retryWithoutInterval.ok) {
			return retryWithoutInterval.json();
		}

		response = retryWithoutInterval;
	}

	if (isOhlcEndpoint && hasMaxDaysParam && response.status === 401) {
		const withYearWindow = replaceMaxDaysWithYear(stripIntervalParam(params));
		const retryWithYearWindow = await request(BASE_URL, withYearWindow);

		if (retryWithYearWindow.ok) {
			return retryWithYearWindow.json();
		}

		response = retryWithYearWindow;
	}

	if (BASE_URL.includes(PRO_API_HOST) && response.status === 400) {
		const demoResponse = await request(DEMO_BASE_URL, params);

		if (demoResponse.ok) {
			return demoResponse.json();
		}

		if (isOhlcEndpoint && hasIntervalParam) {
			const paramsWithoutInterval = stripIntervalParam(params);
			const demoWithoutInterval = await request(DEMO_BASE_URL, paramsWithoutInterval);

			if (demoWithoutInterval.ok) {
				return demoWithoutInterval.json();
			}

			response = demoWithoutInterval;

			if (hasMaxDaysParam && response.status === 401) {
				const withYearWindow = replaceMaxDaysWithYear(paramsWithoutInterval);
				const demoWithYearWindow = await request(DEMO_BASE_URL, withYearWindow);

				if (demoWithYearWindow.ok) {
					return demoWithYearWindow.json();
				}

				response = demoWithYearWindow;
			}
		} else {
			response = demoResponse;

			if (isOhlcEndpoint && hasMaxDaysParam && response.status === 401) {
				const withYearWindow = replaceMaxDaysWithYear(stripIntervalParam(params));
				const demoWithYearWindow = await request(DEMO_BASE_URL, withYearWindow);

				if (demoWithYearWindow.ok) {
					return demoWithYearWindow.json();
				}

				response = demoWithYearWindow;
			}
		}
	}

	const errorMessage = await readError(response);

	throw new Error(`API Error: ${response.status}: ${errorMessage}`);
}

export async function getPools(
	id: string,
	network?: string | null,
	contractAddress?: string | null,
): Promise<PoolData> {
	const fallback: PoolData = {
		id: "",
		address: "",
		name: "",
		network: "",
	};

	if (network && contractAddress) {
		try {
			const poolData = await fetcher<{ data: PoolData[] }>(
				`/onchain/networks/${network}/tokens/${contractAddress}/pools`,
			);

			return poolData.data?.[0] ?? fallback;
		} catch (error) {
			console.log(error);
			return fallback;
		}
	}

	try {
		const poolData = await fetcher<{ data: PoolData[] }>(
			"/onchain/search/pools",
			{ query: id },
		);

		return poolData.data?.[0] ?? fallback;
	} catch {
		return fallback;
	}
}
