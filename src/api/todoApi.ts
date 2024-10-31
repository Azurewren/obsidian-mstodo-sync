import { PublicClientApplication, AccountInfo, InteractionRequiredAuthError } from "@azure/msal-browser";
import * as msalCommon from '@azure/msal-common';
import { Client } from '@microsoft/microsoft-graph-client';
import { TodoTask, TodoTaskList } from '@microsoft/microsoft-graph-types';
import { DataAdapter, Notice } from 'obsidian';
import { MicrosoftAuthModal } from '../gui/microsoftAuthModal';
import { t } from '../lib/lang';

export class TodoApi {
	private client: Client;
	constructor() {
		new MicrosoftClientProvider().getClient().then((client) => (this.client = client));
	}
	// List operation
	async getLists(searchPattern?: string): Promise<TodoTaskList[] | undefined> {
		const endpoint = '/me/todo/lists';
		const todoLists = (await this.client.api(endpoint).get()).value as TodoTaskList[];
		return await Promise.all(
			todoLists.map(async (taskList) => {
				const containedTasks = await this.getListTasks(taskList.id, searchPattern);
				return {
					...taskList,
					tasks: containedTasks,
				};
			}),
		);
	}
	async getListIdByName(listName: string | undefined): Promise<string | undefined> {
		if (!listName) return;
		const endpoint = '/me/todo/lists';
		const res: TodoTaskList[] = (
			await this.client.api(endpoint).filter(`contains(displayName,'${listName}')`).get()
		).value;
		if (!res || res.length == 0) return;
		const target = res[0] as TodoTaskList;
		return target.id;
	}
	async getList(listId: string | undefined): Promise<TodoTaskList | undefined> {
		if (!listId) return;
		const endpoint = `/me/todo/lists/${listId}`;
		return (await this.client.api(endpoint).get()) as TodoTaskList;
	}
	async createTaskList(displayName: string | undefined): Promise<TodoTaskList | undefined> {
		if (!displayName) return;
		return await this.client.api('/me/todo/lists').post({
			displayName,
		});
	}

	// Task operation
	async getListTasks(listId: string | undefined, searchText?: string): Promise<TodoTask[] | undefined> {
		if (!listId) return;
		const endpoint = `/me/todo/lists/${listId}/tasks`;
		if (!searchText) return;
		const res = await this.client
			.api(endpoint)
			.filter(searchText)
			.get()
			.catch((err) => {
				new Notice(t('Notice_UnableToAcquireTaskFromConfiguredList'));
				return;
			});
		if (!res) return;
		return res.value as TodoTask[];
	}
	async getTask(listId: string, taskId: string): Promise<TodoTask | undefined> {
		const endpoint = `/me/todo/lists/${listId}/tasks/${taskId}`;
		return (await this.client.api(endpoint).get()) as TodoTask;
	}

	async createTaskFromToDo(listId: string | undefined, toDo: TodoTask): Promise<TodoTask> {
		const endpoint = `/me/todo/lists/${listId}/tasks`;
		return await this.client.api(endpoint).post(toDo);
	}

	async updateTaskFromToDo(listId: string | undefined, taskId: string, toDo: TodoTask): Promise<TodoTask> {
		const endpoint = `/me/todo/lists/${listId}/tasks/${taskId}`;
		return await this.client.api(endpoint).patch(toDo);
	}
}

export class MicrosoftClientProvider {
	private readonly clientId = '1950a258-227b-4e31-a9cf-717495945fc2';
	private readonly authority = 'https://login.microsoftonline.com/e0b58b8f-6524-4354-a672-42b0d236fa6d';
	private readonly scopes: string[] = ["https://management.core.windows.net//.default"];
	private readonly pca: PublicClientApplication;
	private readonly adapter: DataAdapter;

	constructor() {
		this.adapter = app.vault.adapter;

		const config = {
			 auth: {
			  clientId: this.clientId,
			  authority: this.authority,
			 },
			 cache: {
			  cacheLocation: "localStorage", // or "sessionStorage"
			  storeAuthStateInCookie: false, // set to true if you want to store the auth state in a cookie
			 },
			};
		this.pca = new PublicClientApplication(config);
	}

	private async getAccessToken() {
		await this.pca.initialize();
		const accounts = await this.pca.getAllAccounts();
	   if (accounts.length == 0) {
		   return await this.acquireTokenInteractive();
	   } else {
		   return await this.authByCache(accounts[0]);
	   }
	}
	
	
	private async acquireTokenInteractive(): Promise<string> {
		const request = {
			scopes: this.scopes,
		};
		try {
			await this.pca.acquireTokenRedirect(request);
			return Promise.reject('User will be redirected for authentication.');
		} catch (err) {
			if (err instanceof InteractionRequiredAuthError) {
				const accounts = await this.pca.getAllAccounts();
				if (accounts.length > 0) {
					const silentRequest = {
						account: accounts[0],
						scopes: this.scopes,
					};
					try {
						const response = await this.pca.acquireTokenSilent(silentRequest);
						return response.accessToken;
					} catch (error) {
						console.error('Silent authentication failed', error);
						return Promise.reject(error);
					}
				}
			}
			return Promise.reject(err);
		}
	}


	private async authByCache(account: AccountInfo): Promise<string> {
		const silentRequest = {
			account: account,
			scopes: this.scopes,
		};
		return await this.pca
			.acquireTokenSilent(silentRequest)
			.then((res) => {
				return res == null ? 'error' : res['accessToken'];
			})
			.catch(async (err) => {
				return await this.acquireTokenInteractive();
			});
	}

	public async getClient() {
		const authProvider = async (callback: (arg0: string, arg1: string) => void) => {
			const accessToken = await this.getAccessToken();
			const error = ' ';
			callback(error, accessToken);
		};
		return Client.init({
			authProvider,
		});
	}
}
