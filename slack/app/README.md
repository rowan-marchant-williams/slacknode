#slack/app

This app provides a http endpoint for Slack to post events to.

These events are transformed into protobuf messages and sent into the platform service infrastructure. This app then responds to events raised by the platform and calls back to Slack to send messages back to Slack users.

It assumes use of the Slack Events API. This therefore requires an App to be created in Slack, which is configured with event subscriptions that will be posted to this node app.

##To create and configure the AdminConsoleBot app in Slack

###Create the app in Slack
* Go to <https://api.slack.com/apps> and click Create New App.
* Enter `AdminConsoleBot` as the name
* Ensure correct team is selected
* *Do not* tick I plan to submit this app to the Slack App Directory
* Click `Create App`
* Note the `Client ID`, `Client Secret` and `Verification Token`, these are to be used when requesting an Auth token, when installing the app in a later step

###Configure OAuth
* Click on `OAuth and Permissions`
* Enter a https URL into the Redirect URL(s) box - Slack redirects to this url as part of its OAuth token generation process. This URL is not used for anything else apart from during the OAuth token generation process.

###Configure a bot user
* Click on `Bot Users` 
* Create a bot user called `@adminconsolebot` and click `Save Changes`

###Configure event subscriptions
* Click on `Event Subscriptions`
* Enter `https://[domain]/requests/adminbot` into the Request URL field - this where Slack will post its event to. Slack will initially verify the URL by posting a challenge payload which it expects to receive back in the response. Once verified, Slack should indicate that the URL has been verified shortly after entering the URL.
* Click `Add Bot User Event` to add subscribe to the following events:
    * `message.channels`
    * `message.im`
* Click `Save Changes`

The app is now configured. It must now be installed into a Slack Team.

##To install the app into a Slack Team

###Overview of installing a Slack app and retrieving an Auth token

Installing a Slack app would typically be achieved by placing an `Add to Slack` button on a website. 

A user wishing to install the app would click the button, and then be redirected to Slack to approve the authorisation scopes requested by the app. Once approved by the user, they would then be redirected back to the original website. 

When redirecting back to the original website, Slack includes an interim OAuth request token as a GET parameter. The originating website must then take this interim OAuth request token and post it to Slack along with the App Client ID and Client Secret.
 
Slack finally responds with the apps Auth token. The app is then required to use this token in all of its api calls into Slack.

###How to install this app

A webpage containing an `Add to Slack` button has not been created as yet, and we will therefore perform the above steps manually.

Slack provides all of the URLs we need require to perform this process manually: 

* Ensure you are logged into Slack in a browser. Get the `Add to Slack` URL by going to <https://api.slack.com/docs/slack-button>. 
* Scroll down to the `Add the Slack button` section. You will see a pre-populated `Add to Slack` button.
* Ensure your new app is selected in the dropdown box on the right
* Check the `bot` checkbox and uncheck the `incoming webhook` and `commands` checkboxes
* Copy the url in the generated `a` tag. It should look something like this: `https://slack.com/oauth/authorize?scope=bot&client_id=109481702759.113250645956`
* Add the `files:write:user` OAuth scope by adding `,files:write:user` after `scope=bot` in the URL. The resulting URL will look something like this:
`https://slack.com/oauth/authorize?scope=bot,files:write:user&client_id=109481702759.113250645956`
* Using a browser, go to the URL just created.
* This will take you to an OAuth authorization page in Slack, to confirm the OAuth sccopes requested by the app. Ensure the correct team is selected and click `Authorize`
* Slack will redirect the browser to the URL you configured in the `OAuth and Permissions` section of the App configuration. The url will contain a GET parameter named `code`. 
* Copy the value of the `code` parameter from the URL
* Call the oauth.access api method using the Slack api tester page - Go to <https://api.slack.com/methods/oauth.access/test>
* Enter the `client_id`, `client_secret` and `code` and click `Test Method`
* The Slack response will be shown below and should look something like this:
```json
{
		"ok": true,
		"access_token": "xoxp-109481702759-109481702887-114241888595-190b44add1fc47a2953c523d500e78f0",
		"scope": "identify,bot",
		"user_id": "U37E5LNS3",
		"team_name": "RMWDev",
		"team_id": "T37E5LNNB",
		"bot": {
			"bot_user_id": "U3B4A3D0T",
			"bot_access_token": "xoxb-113146115027-Donr4kpWlkkeuHkKpii1SCDH"
		}
	}
```
* Note the `bot_access_token` to be set as an environment variable below

###Set Environment Variables

The app assumes the following enviroment variables have been set:

* SLACK_BOT_TOKEN - to be set to the `bot_access_token` noted as the final step above
* SLACK_VERIFICATION_TOKEN - to be set to the app `Verification Token` noted when creating the app

###Configuration of slack/app

The slack node app is configured with the `common/config/slack.json` configuration file.

Audit channels and user lists must be populated in this .json configuration file

Slack users and their ids can be found by running this:

<https://api.slack.com/methods/users.list/test>

Slack channels and their ids can be found by running this:

<https://api.slack.com/methods/channels.list/test>

##Additional npm packages in use

This app uses the following npm packages which need to be included the i2O MyGet feed:
* [@slack/client](https://www.npmjs.com/package/@slack/client) - used to call the Slack web api
* [adm-zip](git://github.com/cthackers/adm-zip.git) - used to perform in memory zipping / unzipping
* [form-data](https://www.npmjs.com/package/form-data) - used to post files into slack from the node app. The node slack client does not support posting binary files