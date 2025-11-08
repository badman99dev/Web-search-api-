document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('search-form');
    const output = document.getElementById('output');
    const submitButton = document.getElementById('submit-button');
    const slider = document.getElementById('num_results');
    const sliderValue = document.getElementById('num-results-value');

    slider.addEventListener('input', () => {
        sliderValue.textContent = slider.value;
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        output.value = "Searching and summarizing... Please wait.";
        submitButton.disabled = true;

        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());
        data.num_results = parseInt(data.num_results, 10);

        try {
            const response = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            output.value = result.result;
        } catch (error) {
            output.value = "An error occurred: " + error.message;
        } finally {
            submitButton.disabled = false;
        }
    });

    // Load analytics data when tab is switched or page loads
    loadAnalytics();
});

function openTab(evt, tabName) {
    const tabContents = document.getElementsByClassName("tab-content");
    for (let i = 0; i < tabContents.length; i++) {
        tabContents[i].style.display = "none";
    }
    const tabLinks = document.getElementsByClassName("tab-link");
    for (let i = 0; i < tabLinks.length; i++) {
        tabLinks[i].className = tabLinks[i].className.replace(" active", "");
    }
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.className += " active";
}

let requestsChart, avgTimeChart;

async function loadAnalytics() {
    try {
        const response = await fetch('/api/analytics');
        const data = await response.json();

        // Chart for Daily Requests
        const reqCtx = document.getElementById('requestsChart').getContext('2d');
        if(requestsChart) requestsChart.destroy();
        requestsChart = new Chart(reqCtx, {
            type: 'bar',
            data: {
                labels: data.requestsData.map(d => d.date),
                datasets: [{
                    label: 'Daily Requests',
                    data: data.requestsData.map(d => d.count),
                    backgroundColor: 'rgba(187, 134, 252, 0.6)',
                    borderColor: 'rgba(187, 134, 252, 1)',
                    borderWidth: 1
                }]
            },
            options: { scales: { y: { beginAtZero: true } } }
        });

        // Chart for Average Response Time
        const timeCtx = document.getElementById('avgTimeChart').getContext('2d');
        if(avgTimeChart) avgTimeChart.destroy();
        avgTimeChart = new Chart(timeCtx, {
            type: 'bar',
            data: {
                labels: data.avgTimeData.map(d => d.date),
                datasets: [{
                    label: 'Avg. Response Time (s)',
                    data: data.avgTimeData.map(d => d.avg_time),
                    backgroundColor: 'rgba(3, 218, 198, 0.6)',
                    borderColor: 'rgba(3, 218, 198, 1)',
                    borderWidth: 1
                }]
            },
            options: { scales: { y: { beginAtZero: true } } }
        });

    } catch (error) {
        console.error("Failed to load analytics:", error);
    }
}
