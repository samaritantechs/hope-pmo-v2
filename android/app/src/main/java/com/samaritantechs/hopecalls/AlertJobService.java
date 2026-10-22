package com.samaritantechs.hopecalls;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

/**
 * The background half of the imprest alerts (see AlertPoller): a periodic job Android runs
 * about every fifteen minutes -- its floor for a periodic job -- whether or not the app is open,
 * surviving a reboot (persisted). Scheduled when a portal code signs in on this handset and
 * cancelled when it signs out (MainActivity.startOrStopLocationService_), so a handset that is
 * only ever HOPE Calls never runs it. No Play Services, no WorkManager: JobScheduler is in the
 * platform, which is the rule this app keeps for every dependency.
 */
public class AlertJobService extends JobService {
    private static final int JOB_ID = 4472;
    private static final long PERIOD_MS = 15 * 60 * 1000L;

    static void schedule(Context ctx) {
        JobScheduler js = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null) return;
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(ctx, AlertJobService.class))
                .setPeriodic(PERIOD_MS)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .build();
        try { js.schedule(job); } catch (Exception ignored) { /* a handset that refuses the job simply polls while open */ }
    }

    static void cancel(Context ctx) {
        JobScheduler js = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js != null) js.cancel(JOB_ID);
    }

    @Override
    public boolean onStartJob(final JobParameters params) {
        new Thread(() -> {
            try { AlertPoller.pollNow(this); }
            finally { jobFinished(params, false); }
        }).start();
        return true;    // still running on the thread above
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;    // cut short by the system: ask again at the next window
    }
}
