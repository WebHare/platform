if (document.body) {
  showMessage();
} else {
  document.addEventListener("DOMContentLoaded", showMessage);
}

function showMessage() {
  const div = document.createElement("div");
  div.textContent = "Compilation of this test failed";
  document.body.appendChild(div);
}

const testfw = window.parent ? window.parent.__testframework : null;
if (testfw) {
  const steps = [ {
    name: "test compilation failed",
    test: function gotTestError() {
      let bundlestatus = JSON.parse(document.getElementById("wh-test-bundlestatus").textContent);
      testfw.log(`Got compilation errors for ${bundlestatus.file}:\n${bundlestatus.errors}`);
      throw new Error(`Compilation of ${bundlestatus.file} failed: ${bundlestatus.errors}`);
    }
  } ];
  let setTestSuiteCallbacks = () => void(0);
  let module_exports;

  testfw.runTestSteps(steps, setTestSuiteCallbacks, module_exports);
}
