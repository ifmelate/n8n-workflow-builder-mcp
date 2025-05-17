const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Get all test files in the unit directory
const unitTestDir = path.join(__dirname, 'unit');
const testFiles = fs.readdirSync(unitTestDir)
    .filter(file => file.endsWith('.test.js'))
    .map(file => path.join(unitTestDir, file));

console.log('Running memory connection tests...\n');

// Results tracking
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

// Run each test file
testFiles.forEach(testFile => {
    console.log(`\n==== Running tests from ${path.basename(testFile)} ====`);

    try {
        const output = execSync(`node ${testFile}`, { encoding: 'utf8' });
        console.log(output);

        // Parse results from output
        const summaryMatch = output.match(/Total: (\d+), Passed: (\d+), Failed: (\d+)/);
        if (summaryMatch) {
            const fileTotal = parseInt(summaryMatch[1], 10);
            const filePassed = parseInt(summaryMatch[2], 10);
            const fileFailed = parseInt(summaryMatch[3], 10);

            totalTests += fileTotal;
            passedTests += filePassed;
            failedTests += fileFailed;
        }
    } catch (error) {
        console.error(`Error running ${testFile}:`);
        console.error(error.message);
        failedTests++;
    }
});

// Print overall summary
console.log('\n======================================');
console.log('           OVERALL SUMMARY           ');
console.log('======================================');
console.log(`Total Test Files: ${testFiles.length}`);
console.log(`Total Tests: ${totalTests}`);
console.log(`Passed: ${passedTests}`);
console.log(`Failed: ${failedTests}`);
console.log('======================================');

// Exit with appropriate code
process.exit(failedTests > 0 ? 1 : 0); 