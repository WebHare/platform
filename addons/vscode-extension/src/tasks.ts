import path = require('path');
import { ProcessExecution, ShellExecution, Task, TaskPanelKind, TaskScope, type Uri, tasks, window } from 'vscode';

export async function runScript(uri: Uri) {
	const resourcepath = (uri || window.activeTextEditor.document.uri).path;
	const task = new Task(
		{ type: 'shell' },
		TaskScope.Workspace,
		path.basename(resourcepath),
		"whrun",
		new ProcessExecution(process.env.HOME + "/projects/webhare-runkit/bin/runkit", ["wh", "run", resourcepath])
	);

	task.isBackground = false;
	task.presentationOptions.clear = true;
	// task.presentationOptions.focus = true;
	task.presentationOptions.panel = TaskPanelKind.Dedicated;
	task.presentationOptions.echo = false;
	task.presentationOptions.close = false;

	const taskrunner = await tasks.executeTask(task);
	console.log(taskrunner);
}
