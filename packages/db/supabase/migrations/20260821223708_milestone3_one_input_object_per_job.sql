create unique index job_objects_one_input_per_job
  on public.job_objects (job_id)
  where role = 'input';
